import React, { useRef, useEffect, useState } from 'react';
import type { Message, MessagePart } from '../types';
import { MicIcon } from './icons/MicIcon';
import { MicMuteIcon } from './icons/MicMuteIcon';
import { StopIcon } from './icons/StopIcon';
import { Spinner } from './Spinner';
import { PaperclipIcon } from './icons/PaperclipIcon';
import { XCircleIcon } from './icons/XCircleIcon';

interface ChatPanelProps {
  messages: Message[];
  status: string;
  error: string | null;
  onToggleConversation: () => void;
  currentConversationId: string | null;
  topic: 'general' | 'speech-therapy' | 'learn-english';
  isLiveConnected: boolean;
  isMicMuted: boolean;
  onToggleMicMute: () => void;
  attachedFile: File | null;
  onFileAttach: (file: File) => void;
  onFileClear: () => void;
}

const renderPart = (part: MessagePart, index: number) => {
  switch (part.type) {
    case 'text':
      return <p key={index} className="whitespace-pre-wrap">{part.content}</p>;
    case 'image':
      return <img key={index} src={part.uri} alt={part.alt || 'generated image'} className="mt-2 rounded-lg max-w-full h-auto" />;
    case 'sources':
      return (
        <div key={index} className="mt-2">
          <h4 className="font-semibold text-sm text-gray-300">Sources:</h4>
          <ul className="list-disc list-inside space-y-1">
            {part.items.map((source, i) => (
              <li key={i}>
                <a href={source.uri} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline text-sm" title={source.title}>
                  {source.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      );
    case 'youtube':
      return (
        <div key={index} className="mt-4 space-y-4">
            {part.videos.map((video) => (
              <div 
                key={video.id} 
                className="w-full bg-gray-800 border border-gray-700 rounded-lg shadow-md overflow-hidden"
              >
                <div className="relative w-full aspect-video">
                  <iframe
                    className="absolute top-0 left-0 w-full h-full"
                    src={`https://www.youtube.com/embed/${video.id}?origin=${window.location.origin}`}
                    title={video.title}
                    frameBorder="0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  ></iframe>
                </div>
                <div className="p-3">
                  <h5 className="font-semibold text-white text-md mb-1 line-clamp-2" title={video.title}>
                    {video.title}
                  </h5>
                   <p className="text-xs text-gray-400 mb-2 truncate">
                    {video.channel}
                  </p>
                  <p className="text-sm text-gray-300 line-clamp-2">
                    {video.description}
                  </p>
                  <a
                    href={`https://www.youtube.com/watch?v=${video.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:underline mt-2 inline-block"
                  >
                    Watch on YouTube
                  </a>
                </div>
              </div>
            ))}
          </div>
      );
    default:
      return null;
  }
};


export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages, status, error, onToggleConversation, currentConversationId, topic,
  isLiveConnected, isMicMuted, onToggleMicMute, attachedFile, onFileAttach, onFileClear,
}) => {
  const transcriptContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);

  useEffect(() => {
    if (transcriptContainerRef.current) {
      transcriptContainerRef.current.scrollTop = transcriptContainerRef.current.scrollHeight;
    }
  }, [messages]);
  
  useEffect(() => {
    if (attachedFile) {
        const reader = new FileReader();
        reader.onloadend = () => setFilePreview(reader.result as string);
        reader.readAsDataURL(attachedFile);
    } else {
        setFilePreview(null);
    }
  }, [attachedFile]);

  const getStatusColor = () => {
    switch(status) {
      case 'Thinking...': case 'Connecting...': return 'text-yellow-400';
      case 'Listening...': return 'text-green-400';
      case 'Speaking...': return 'text-blue-400';
      case 'Error': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  const getTopicDisplayName = () => {
    switch(topic) {
      case 'speech-therapy': return 'Speech Therapy';
      case 'learn-english': return 'Learn English';
      default: return 'General';
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      onFileAttach(event.target.files[0]);
    }
  };

  const isLoading = status === 'Connecting...' || status === 'Thinking...';

  return (
    <div className="flex flex-col h-full bg-gray-900 relative">
      <header className="p-4 flex justify-center items-center border-b border-gray-700 shadow-lg flex-shrink-0">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
            Zud Assistance
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Topic: <span className="font-semibold">{getTopicDisplayName()}</span>
          </p>
        </div>
      </header>
      <main className="flex-1 flex flex-col p-4 md:p-6 overflow-hidden pb-40">
        <div 
          ref={transcriptContainerRef} 
          className="flex-1 overflow-y-auto p-4 bg-gray-800/50 rounded-lg space-y-4 scroll-smooth"
        >
          {messages.length === 0 && !isLiveConnected && !isLoading && (
            <div className="flex items-center justify-center h-full">
              <p className="text-gray-500 text-lg text-center">
                {currentConversationId ? 'Press the microphone to start.' : 'Start a new chat or select one from history.'}
              </p>
            </div>
          )}
           {isLoading && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full">
              <Spinner />
              <p className="text-gray-500 text-lg mt-4">{status}</p>
            </div>
          )}
          {messages.map((message) => {
            const hasWideContent = message.parts.some(p => p.type === 'youtube');
            return (
              <div key={message.id} className={`flex ${message.speaker === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`flex flex-col ${hasWideContent ? 'w-full max-w-full' : 'max-w-xs md:max-w-md lg:max-w-2xl'} px-4 py-2 rounded-xl ${message.speaker === 'user' ? 'bg-blue-600' : 'bg-gray-700'}`}>
                  <span className="font-bold capitalize">{message.speaker === 'user' ? 'You' : 'Zud'}: </span>
                  {message.parts.map(renderPart)}
                </div>
              </div>
            );
          })}
        </div>
      </main>

      <div className="absolute bottom-0 left-0 right-0 bg-gray-900">
        {filePreview && (
            <div className="relative w-24 h-24 mb-4 mx-auto">
                <img src={filePreview} alt="attachment preview" className="w-full h-full object-cover rounded-md" />
                <button onClick={onFileClear} className="absolute -top-2 -right-2 bg-gray-800 rounded-full text-white hover:bg-gray-700">
                    <XCircleIcon className="w-6 h-6"/>
                </button>
            </div>
        )}

        <div className="flex flex-col items-center justify-center p-4 border-t border-gray-700">
          <p className={`mb-4 text-lg font-medium transition-colors duration-300 ${getStatusColor()}`}>{status}</p>
          <div className="flex items-center gap-4">
            <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center w-12 h-12 rounded-full bg-gray-600 hover:bg-gray-700 transition-colors disabled:opacity-50"
                aria-label="Attach file"
                disabled={isLiveConnected}
            >
              <PaperclipIcon className="w-6 h-6" />
            </button>
            <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
            
            <button
              onClick={onToggleConversation}
              className={`relative flex items-center justify-center w-20 h-20 rounded-full transition-all duration-300 focus:outline-none focus:ring-4 focus:ring-opacity-50
                ${(isLiveConnected) ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500' : 'bg-green-600 hover:bg-green-700 focus:ring-green-500'}
                disabled:opacity-50 disabled:cursor-not-allowed
              `}
              aria-label={isLiveConnected ? 'Stop conversation' : 'Start conversation'}
              disabled={!currentConversationId}
            >
              {isLoading ? <Spinner /> : isLiveConnected ? <StopIcon className="w-10 h-10 text-white" /> : <MicIcon className="w-10 h-10 text-white" />}
              {isLiveConnected && !isLoading && status === 'Listening...' && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
              )}
            </button>

            <button
                onClick={onToggleMicMute}
                className={`flex items-center justify-center w-12 h-12 rounded-full transition-colors disabled:opacity-50 ${isMicMuted ? 'bg-yellow-600' : 'bg-gray-600 hover:bg-gray-700'}`}
                aria-label={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
                disabled={!isLiveConnected}
            >
              {isMicMuted ? <MicMuteIcon className="w-6 h-6" /> : <MicIcon className="w-6 h-6" />}
            </button>
          </div>
          {error && <p className="mt-4 text-red-400 text-center">Error: {error}</p>}
        </div>
      </div>
    </div>
  );
};