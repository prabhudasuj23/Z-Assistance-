import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, FunctionDeclaration, Type, Part, Tool } from '@google/genai';
import type { Message, MessagePart, TextPart } from '../types';
import { createBlob, decode, decodeAudioData } from '../utils/audioUtils';

interface LiveSession {
  sendRealtimeInput: (params: { media: { data: string; mimeType: string; } }) => void;
  sendToolResponse: (params: any) => void;
  close: () => void;
}

const generateImageFunctionDeclaration: FunctionDeclaration = {
    name: 'generateImage',
    parameters: {
      type: Type.OBJECT,
      description: 'Generate an image based on a user description.',
      properties: {
        prompt: {
          type: Type.STRING,
          description: 'A detailed description of the image to generate.',
        },
      },
      required: ['prompt'],
    },
};

const googleSearchFunctionDeclaration: FunctionDeclaration = {
    name: 'googleSearch',
    parameters: {
        type: Type.OBJECT,
        description: "Get information from Google Search. Use this for questions about current events, facts, or information you don't know.",
        properties: {
            query: {
                type: Type.STRING,
                description: "The search query."
            }
        },
        required: ["query"]
    }
};

const tools: Tool[] = [{
    functionDeclarations: [generateImageFunctionDeclaration, googleSearchFunctionDeclaration],
}];

export const useZud = () => {
  const [status, setStatus] = useState('Ready');
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);

  const aiRef = useRef<GoogleGenAI | null>(null);
  const sessionPromiseRef = useRef<Promise<LiveSession> | null>(null);
  
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  
  const isMicMutedRef = useRef(isMicMuted);
  isMicMutedRef.current = isMicMuted;

  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');

  const clearSessionMessages = useCallback(() => setMessages([]), []);

  const stopAudioPlayback = () => {
    if (outputAudioContextRef.current) {
        for (const source of audioSourcesRef.current.values()) {
            source.stop();
            audioSourcesRef.current.delete(source);
        }
        nextStartTimeRef.current = 0;
    }
  };

  const stop = useCallback(() => {
    sessionPromiseRef.current?.then(session => session.close());
    sessionPromiseRef.current = null;

    microphoneStreamRef.current?.getTracks().forEach(track => track.stop());
    microphoneStreamRef.current = null;
    
    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;

    if (inputAudioContextRef.current?.state !== 'closed') {
      inputAudioContextRef.current.close().catch(console.error);
    }
    inputAudioContextRef.current = null;

    stopAudioPlayback();
    if (outputAudioContextRef.current?.state !== 'closed') {
        outputAudioContextRef.current.close().catch(console.error);
    }
    outputAudioContextRef.current = null;

    setIsLiveConnected(false);
    setStatus('Ready');
    setError(null);
  }, []);

  const addMessage = (message: Message) => {
    setMessages(prev => [...prev, message]);
  }

  const start = useCallback(async (
    history: Message[] = [],
    topic: 'general' | 'speech-therapy' | 'learn-english',
    language: 'en-US' | 'te-IN',
    imagePart?: Part,
  ) => {
    if (isLiveConnected) return;
    
    setStatus('Connecting...');
    setError(null);
    setMessages([]);
    currentInputTranscriptionRef.current = '';
    currentOutputTranscriptionRef.current = '';

    try {
      if (!process.env.API_KEY) throw new Error('API_KEY environment variable not set.');
      aiRef.current = new GoogleGenAI({ apiKey: process.env.API_KEY });

      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      const historyText = history.length > 0
        ? '\n\nThis is the conversation history so far:\n' + history.map(m => {
            // Fix: Use a type predicate to correctly narrow the type of `p` to `TextPart`.
            const textContent = m.parts.filter((p): p is TextPart => p.type === 'text').map(p => p.content).join(' ');
            return `${m.speaker === 'user' ? 'User' : 'Zud'}: ${textContent}`
        }).join('\n') + '\nContinue the conversation.'
        : '';
      
      const topicInstructions = {
        'speech-therapy': `You are a specialized speech therapy assistant. Speak slowly and clearly. Guide the user through speech exercises. Be patient and supportive. Focus on articulation and fluency.`,
        'learn-english': `You are an expert English language tutor. Speak clearly in English. Help the user practice their pronunciation, vocabulary, and grammar. Keep your responses encouraging and conversational.`,
        'general': 'You are a friendly and helpful voice assistant. Keep your responses concise and conversational.',
      };

      const languageInstruction = language === 'te-IN' ? 'You MUST respond in the Telugu language.' : 'You MUST respond in English.';
      const systemInstruction = `You are Zud Assistance. ${topicInstructions[topic]} ${languageInstruction} ${historyText}`;

      if (imagePart) {
        addMessage({ id: Date.now().toString(), speaker: 'user', parts: [imagePart as MessagePart] });
      }
      
      const sessionPromise = aiRef.current.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
            systemInstruction: systemInstruction,
            tools: tools,
        },
        callbacks: {
            onopen: async () => {
                setIsLiveConnected(true);
                setStatus('Listening...');

                try {
                    microphoneStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
                    inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                    const source = inputAudioContextRef.current.createMediaStreamSource(microphoneStreamRef.current);
                    scriptProcessorRef.current = inputAudioContextRef.current.createScriptProcessor(4096, 1, 1);

                    if (imagePart) {
                        // This API doesn't support sending an image directly, so we will handle it via function calls if needed,
                        // or rely on the text prompt that accompanies the image upload.
                        // The image is displayed on the UI and the text context is sent to the model.
                    }

                    scriptProcessorRef.current.onaudioprocess = (audioProcessingEvent) => {
                        if (isMicMutedRef.current) return;
                        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                        const pcmBlob = createBlob(inputData);
                        sessionPromiseRef.current?.then((session) => session.sendRealtimeInput({ media: pcmBlob }));
                    };

                    source.connect(scriptProcessorRef.current);
                    scriptProcessorRef.current.connect(inputAudioContextRef.current.destination);

                } catch (err) {
                    // FIX: Safely handle the 'unknown' error type by checking if it's an instance of Error before accessing the 'message' property.
                    const errorMessage = err instanceof Error ? err.message : String(err);
                    setError(`Microphone error: ${errorMessage}`);
                    setStatus('Error');
                    stop();
                }
            },
            onmessage: async (message: LiveServerMessage) => {
                if (message.serverContent?.outputTranscription) {
                    currentOutputTranscriptionRef.current += message.serverContent.outputTranscription.text;
                } else if (message.serverContent?.inputTranscription) {
                    currentInputTranscriptionRef.current += message.serverContent.inputTranscription.text;
                }

                if (message.toolCall) {
                    setStatus('Thinking...');
                    for (const fc of message.toolCall.functionCalls) {
                        let functionResponse;
                        try {
                            if (fc.name === 'generateImage' && aiRef.current) {
                                const { prompt } = fc.args;
                                const response = await aiRef.current.models.generateImages({
                                    model: 'imagen-4.0-generate-001',
                                    prompt: prompt,
                                    config: { numberOfImages: 1, outputMimeType: 'image/jpeg' },
                                });
                                const base64ImageBytes = response.generatedImages[0].image.imageBytes;
                                const imageUrl = `data:image/jpeg;base64,${base64ImageBytes}`;

                                addMessage({ id: Date.now().toString(), speaker: 'model', parts: [{ type: 'image', uri: imageUrl, alt: prompt }] });
                                functionResponse = { result: "OK, I've generated that image for you." };
                            } else if (fc.name === 'googleSearch' && aiRef.current) {
                                const { query } = fc.args;
                                const response = await aiRef.current.models.generateContent({
                                    model: "gemini-2.5-flash",
                                    contents: query,
                                    config: { tools: [{googleSearch: {}}] },
                                });

                                const text = response.text;
                                const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
                                  ?.map(chunk => chunk.web)
                                  .filter(web => web?.uri && web.title) as { uri: string, title: string }[] || [];
                                
                                const parts: MessagePart[] = [{ type: 'text', content: text }];
                                if (sources.length > 0) {
                                    parts.push({ type: 'sources', items: sources });
                                }
                                addMessage({ id: Date.now().toString(), speaker: 'model', parts });
                                functionResponse = { result: text }; // Send the text back to the live model to be spoken
                            }
                        } catch(e) {
                            // FIX: Safely handle the 'unknown' error type by checking if it's an instance of Error before accessing the 'message' property.
                            const errorMessage = e instanceof Error ? e.message : String(e);
                            console.error(e);
                            setError(`Error with tool: ${errorMessage}`);
                            functionResponse = { error: { message: `Tool execution failed: ${errorMessage}` } };
                        }

                        sessionPromiseRef.current?.then((session) => {
                            session.sendToolResponse({
                                functionResponses: { id: fc.id, name: fc.name, response: functionResponse }
                            })
                        });
                    }
                }

                if (message.serverContent?.turnComplete) {
                    const fullInput = currentInputTranscriptionRef.current.trim();
                    if (fullInput) {
                        const parts = imagePart ? [imagePart as MessagePart, { type: 'text', content: fullInput } as MessagePart] : [{ type: 'text', content: fullInput } as MessagePart];
                        addMessage({ id: Date.now().toString(), speaker: 'user', parts });
                    }
                    // Handle model's final text turn if it wasn't part of a tool call
                    const fullOutput = currentOutputTranscriptionRef.current.trim();
                    if (fullOutput) {
                        addMessage({ id: Date.now().toString(), speaker: 'model', parts: [{ type: 'text', content: fullOutput }] });
                    }

                    currentInputTranscriptionRef.current = '';
                    currentOutputTranscriptionRef.current = '';
                    setStatus('Listening...');
                }

                const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
                if (base64Audio && outputAudioContextRef.current) {
                    setStatus('Speaking...');
                    const audioContext = outputAudioContextRef.current;
                    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, audioContext.currentTime);

                    const audioBuffer = await decodeAudioData(decode(base64Audio), audioContext, 24000, 1);
                    const source = audioContext.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(audioContext.destination);
                    source.addEventListener('ended', () => {
                        audioSourcesRef.current.delete(source);
                        if (audioSourcesRef.current.size === 0 && !message.serverContent?.turnComplete) {
                            setStatus('Listening...');
                        }
                    });
                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += audioBuffer.duration;
                    audioSourcesRef.current.add(source);
                }

                if (message.serverContent?.interrupted) stopAudioPlayback();
            },
            onerror: (e: ErrorEvent) => {
                console.error('Session error', e);
                setError(`Session error: ${e.message}`);
                setStatus('Error');
                stop();
            },
            onclose: () => stop(),
        }
      });
      sessionPromiseRef.current = sessionPromise;

    } catch (err) {
      // FIX: Type guard for error message to handle 'unknown' type in catch block.
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('Error starting session:', err);
      setError(`Failed to start session: ${errorMessage}`);
      setStatus('Error');
      setIsLiveConnected(false);
    }
  }, [isLiveConnected, stop]);

  const toggleMicMute = useCallback(() => setIsMicMuted(prev => !prev), []);

  return { start, stop, status, error, messages, clearSessionMessages, isLiveConnected, isMicMuted, toggleMicMute };
};