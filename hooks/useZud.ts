import { useState, useRef, useCallback } from 'react';
import { GoogleGenAI, Modality, LiveServerMessage, FunctionDeclaration, Type, Part, Tool } from '@google/genai';
import type { Message, MessagePart, TextPart, YouTubePart } from '../types';
import { createBlob, decode, decodeAudioData } from '../utils/audioUtils';
import { YOUTUBE_API_KEY } from '../config';

interface LiveSession {
  sendRealtimeInput: (params: { media: { data: string; mimeType: string; } }) => void;
  sendToolResponse: (params: any) => void;
  close: () => void;
}

/**
 * Searches YouTube for videos based on a query using the YouTube Data API v3.
 * @param {string} query - The user's search term.
 * @returns {Promise<Array>} - A promise that resolves to an array of video results.
 */
async function fetchYouTubeVideos(query: string): Promise<YouTubePart['videos']> {
    const apiKey = YOUTUBE_API_KEY;
    // FIX: This comparison is always false when an API key is provided, causing a compile-time error. The check for a falsy key is sufficient.
    if (!apiKey) {
        // Throw a user-friendly error that will be caught and displayed in the UI.
        throw new Error("The YouTube API key is not configured in config.ts. Please add your key to enable video search.");
    }

    const maxResults = 5; // Fetch 5 results
    const apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&type=video&videoEmbeddable=true&maxResults=${maxResults}&key=${apiKey}`;

    try {
        const response = await fetch(apiUrl);
        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`YouTube API error: ${errorData.error.message}`);
        }
        const data = await response.json();

        // Process the items to get the data you need
        const results = data.items.map((item: any) => ({
            id: item.id.videoId,
            title: item.snippet.title,
            channel: item.snippet.channelTitle,
            description: item.snippet.description,
        }));

        return results;

    } catch (error) {
        console.error("Failed to search YouTube:", error);
        // Re-throw the error so it can be handled by the caller
        throw error;
    }
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

const youtubeSearchFunctionDeclaration: FunctionDeclaration = {
    name: 'youtubeSearch',
    parameters: {
        type: Type.OBJECT,
        description: "Search for YouTube videos. Use this to find videos on a specific topic.",
        properties: {
            query: {
                type: Type.STRING,
                description: "The search query for YouTube videos."
            }
        },
        required: ["query"]
    }
};

const tools: Tool[] = [{
    functionDeclarations: [generateImageFunctionDeclaration, googleSearchFunctionDeclaration, youtubeSearchFunctionDeclaration],
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
    sessionPromiseRef.current?.then(session => session.close()).catch(console.error);
    sessionPromiseRef.current = null;

    microphoneStreamRef.current?.getTracks().forEach(track => track.stop());
    microphoneStreamRef.current = null;
    
    scriptProcessorRef.current?.disconnect();
    scriptProcessorRef.current = null;

    const inputCtx = inputAudioContextRef.current;
    if (inputCtx && inputCtx.state !== 'closed') {
      inputCtx.close().catch(console.error);
    }
    inputAudioContextRef.current = null;

    stopAudioPlayback();
    const outputCtx = outputAudioContextRef.current;
    if (outputCtx && outputCtx.state !== 'closed') {
        outputCtx.close().catch(console.error);
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
                    addMessage({ id: `handoff-${Date.now()}`, speaker: 'model', parts: [{ type: 'text', content: "Let me check with my partner AI for better assistance..." }] });
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

                                const text = response.text?.trim();
                                const sources = response.candidates?.[0]?.groundingMetadata?.groundingChunks
                                  ?.map(chunk => chunk.web)
                                  .filter((web): web is { uri: string, title: string } => !!(web?.uri && web.title)) || [];
                                
                                if (text || sources.length > 0) {
                                    const parts: MessagePart[] = [];
                                    if (text) {
                                        parts.push({ type: 'text', content: text });
                                    }
                                    if (sources.length > 0) {
                                        parts.push({ type: 'sources', items: sources });
                                    }
                                    addMessage({ id: Date.now().toString(), speaker: 'model', parts });
                                    functionResponse = { result: text || "I found some information for you." };
                                } else {
                                    const fallbackText = "I looked for that, but couldn't find any specific information.";
                                    addMessage({ id: Date.now().toString(), speaker: 'model', parts: [{ type: 'text', content: fallbackText }] });
                                    functionResponse = { result: fallbackText };
                                }
                            } else if (fc.name === 'youtubeSearch') {
                                const { query } = fc.args;
                                const videos = await fetchYouTubeVideos(query);
                                
                                if (videos.length > 0) {
                                    const summaryText = `Found some videos for you:`;
                                    const textPart: TextPart = { type: 'text', content: summaryText };
                                    const youtubePart: YouTubePart = { type: 'youtube', videos: videos };
                                    addMessage({ id: Date.now().toString(), speaker: 'model', parts: [textPart, youtubePart] });
                                    functionResponse = { result: `OK, I found ${videos.length} videos.` };
                                } else {
                                    const fallbackText = "Sorry, no videos could be found that allow playback here.";
                                    addMessage({ id: Date.now().toString(), speaker: 'model', parts: [{ type: 'text', content: fallbackText }] });
                                    functionResponse = { result: fallbackText };
                                }
                            }
                        } catch(e) {
                            // FIX: Safely handle the 'unknown' error type by checking if it's an instance of Error before accessing the 'message' property.
                            const errorMessage = e instanceof Error ? e.message : String(e);
                            console.error(e);
                            setError(`Error with tool: ${errorMessage}`);
                            addMessage({ id: Date.now().toString(), speaker: 'model', parts: [{ type: 'text', content: `An error occurred: ${errorMessage}` }] });
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
      // FIX: Safely handle the 'unknown' error type by checking if it's an instance of Error before accessing the 'message' property.
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