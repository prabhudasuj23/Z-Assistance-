import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useZud } from './hooks/useZud';
// FIX: import TextPart type for type guarding
import type { Message, TextPart } from './types';
import { HistoryPanel } from './components/HistoryPanel';
import { ChatPanel } from './components/ChatPanel';
import { MenuIcon } from './components/icons/MenuIcon';
import { fileToGenerativePart } from './utils/fileUtils';

type Conversation = {
  id: string;
  title: string;
  messages: Message[];
};

type Conversations = Record<string, Conversation>;

const App: React.FC = () => {
  const [conversations, setConversations] = useState<Conversations>({});
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [isHistoryPanelVisible, setIsHistoryPanelVisible] = useState(window.innerWidth > 768);
  const [language, setLanguage] = useState<'en-US' | 'te-IN'>(() => (localStorage.getItem('z-voice-language') as 'en-US' | 'te-IN') || 'en-US');
  const [topic, setTopic] = useState<'general' | 'speech-therapy' | 'learn-english'>(() => (localStorage.getItem('z-voice-topic') as 'general' | 'speech-therapy' | 'learn-english') || 'general');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);

  // Load from localStorage on initial render
  useEffect(() => {
    try {
      const savedConversations = localStorage.getItem('z-voice-conversations');
      if (savedConversations) {
        setConversations(JSON.parse(savedConversations));
      }
    } catch (error) {
      console.error("Failed to load conversations from localStorage", error);
    }
  }, []);

  // Save settings and conversations to localStorage
  useEffect(() => { localStorage.setItem('z-voice-language', language); }, [language]);
  useEffect(() => { localStorage.setItem('z-voice-topic', topic); }, [topic]);
  useEffect(() => {
    try {
      if (Object.keys(conversations).length > 0) {
        localStorage.setItem('z-voice-conversations', JSON.stringify(conversations));
      } else {
        // If there are no conversations, remove the item from local storage
        localStorage.removeItem('z-voice-conversations');
      }
    } catch (error) {
      console.error("Failed to save conversations to localStorage", error);
    }
  }, [conversations]);

  const {
    start,
    stop,
    status,
    error,
    messages: sessionMessages,
    clearSessionMessages,
    isLiveConnected,
    isMicMuted,
    toggleMicMute
  } = useZud();

  const wasLiveConnectedRef = useRef(false);

  // Effect to process and save conversation when a live session ends
  useEffect(() => {
    if (wasLiveConnectedRef.current && !isLiveConnected && sessionMessages.length > 0 && currentConversationId) {
      const firstUserMessage = sessionMessages.find(m => m.speaker === 'user');
      if (!firstUserMessage) {
        clearSessionMessages();
        return;
      }

      setConversations(prev => {
        const conversationToUpdate = prev[currentConversationId];
        const existingMessages = conversationToUpdate?.messages || [];

        const isNewConversation = conversationToUpdate?.title === 'New Conversation';
        // FIX: Use a type predicate to correctly narrow the type of `p` to `TextPart` to access `content`.
        const firstUserTextPart = firstUserMessage.parts.find((p): p is TextPart => p.type === 'text');
        const firstUserText = firstUserTextPart?.content || 'Image Query';
        const newTitle = isNewConversation
          ? firstUserText.substring(0, 40) + (firstUserText.length > 40 ? '...' : '')
          : conversationToUpdate?.title;

        const updatedConversation = {
          ...conversationToUpdate,
          title: newTitle,
          messages: [...existingMessages, ...sessionMessages],
        };
        return { ...prev, [currentConversationId]: updatedConversation };
      });

      clearSessionMessages();
    }
    wasLiveConnectedRef.current = isLiveConnected;
  }, [isLiveConnected, sessionMessages, currentConversationId, clearSessionMessages]);


  const handleNewChat = useCallback(() => {
    if (isLiveConnected) stop();
    
    const newId = Date.now().toString();
    const newConversation: Conversation = { id: newId, title: 'New Conversation', messages: [] };
    
    setConversations(prev => ({ ...prev, [newId]: newConversation }));
    setCurrentConversationId(newId);
    clearSessionMessages();
    setAttachedFile(null);
    
    if (window.innerWidth < 768) setIsHistoryPanelVisible(false);
  }, [isLiveConnected, stop, clearSessionMessages]);

  const handleSelectConversation = (id: string) => {
    if (isLiveConnected) stop();
    setCurrentConversationId(id);
    clearSessionMessages();
    setAttachedFile(null);
    if (window.innerWidth < 768) setIsHistoryPanelVisible(false);
  };

  const handleToggleConversation = async () => {
    if (isLiveConnected) {
      stop();
    } else {
      let imagePart = null;
      if (attachedFile) {
        imagePart = await fileToGenerativePart(attachedFile);
        setAttachedFile(null); // Clear after processing
      }
      const history = currentConversationId ? conversations[currentConversationId]?.messages || [] : [];
      start(history, topic, language, imagePart || undefined);
    }
  };

  const handleDeleteConversation = (id: string) => {
    setConversations(prev => {
        const newConversations = { ...prev };
        delete newConversations[id];
        return newConversations;
    });
    if (currentConversationId === id) {
        setCurrentConversationId(null);
    }
  };

  const handleUpdateConversationTitle = (id: string, newTitle: string) => {
      setConversations(prev => {
          if (!prev[id]) return prev;
          return {
              ...prev,
              [id]: {
                  ...prev[id],
                  title: newTitle,
              },
          };
      });
  };

  const displayedMessages = (currentConversationId ? conversations[currentConversationId]?.messages : []).concat(sessionMessages);

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-sans relative overflow-hidden">
      {isHistoryPanelVisible && (
        <div
          onClick={() => setIsHistoryPanelVisible(false)}
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          aria-hidden="true"
        ></div>
      )}
      <HistoryPanel
        conversations={Object.values(conversations).sort((a, b) => parseInt(b.id) - parseInt(a.id))}
        currentConversationId={currentConversationId}
        onNewChat={handleNewChat}
        onSelectConversation={handleSelectConversation}
        onDeleteConversation={handleDeleteConversation}
        onUpdateConversationTitle={handleUpdateConversationTitle}
        isVisible={isHistoryPanelVisible}
        language={language}
        onLanguageChange={setLanguage}
        topic={topic}
        onTopicChange={setTopic}
      />
      <div className="flex-1 flex flex-col relative">
        <button
          onClick={() => setIsHistoryPanelVisible(v => !v)}
          className="absolute top-4 left-4 z-20 p-2 rounded-md bg-gray-800/50 hover:bg-gray-700/70 md:hidden"
          aria-label="Toggle history panel"
        >
          <MenuIcon className="w-6 h-6" />
        </button>
        <ChatPanel
          messages={displayedMessages}
          status={status}
          error={error}
          onToggleConversation={handleToggleConversation}
          currentConversationId={currentConversationId}
          topic={topic}
          isLiveConnected={isLiveConnected}
          isMicMuted={isMicMuted}
          onToggleMicMute={toggleMicMute}
          attachedFile={attachedFile}
          onFileAttach={setAttachedFile}
          onFileClear={() => setAttachedFile(null)}
        />
      </div>
    </div>
  );
};

export default App;
