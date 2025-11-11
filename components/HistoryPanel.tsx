import React, { useState, useRef, useEffect } from 'react';
import { PlusIcon } from './icons/PlusIcon';
import { DotsVerticalIcon } from './icons/DotsVerticalIcon';

type Conversation = {
  id: string;
  title: string;
};

interface HistoryPanelProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  onNewChat: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  onUpdateConversationTitle: (id: string, title: string) => void;
  isVisible: boolean;
  language: 'en-US' | 'te-IN';
  onLanguageChange: (lang: 'en-US' | 'te-IN') => void;
  topic: 'general' | 'speech-therapy' | 'learn-english';
  onTopicChange: (topic: 'general' | 'speech-therapy' | 'learn-english') => void;
}

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
  conversations,
  currentConversationId,
  onNewChat,
  onSelectConversation,
  onDeleteConversation,
  onUpdateConversationTitle,
  isVisible,
  language,
  onLanguageChange,
  topic,
  onTopicChange
}) => {
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState('');
    const menuRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setOpenMenuId(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (editingConversationId && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editingConversationId]);

    const handleEdit = (convo: Conversation) => {
        setEditingConversationId(convo.id);
        setEditingTitle(convo.title);
        setOpenMenuId(null);
    };

    const handleSaveTitle = () => {
        if (editingConversationId && editingTitle.trim()) {
            onUpdateConversationTitle(editingConversationId, editingTitle.trim());
        }
        setEditingConversationId(null);
        setEditingTitle('');
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') handleSaveTitle();
        if (e.key === 'Escape') {
            setEditingConversationId(null);
            setEditingTitle('');
        }
    };

    const handleDelete = (id: string) => {
        if (window.confirm('Are you sure you want to delete this conversation?')) {
            onDeleteConversation(id);
        }
        setOpenMenuId(null);
    };


  return (
    <aside className={`absolute md:relative z-40 flex-shrink-0 flex flex-col bg-gray-800 border-r border-gray-700 transition-transform duration-300 ease-in-out h-full w-64 ${isVisible ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}>
        <div className="p-4 border-b border-gray-700 flex justify-between items-center">
            <h2 className="text-xl font-semibold">History</h2>
        </div>

        <div className="p-2 space-y-4">
            <div className="space-y-2">
                <label htmlFor="language-select" className="block text-sm font-medium text-gray-300">Output Language</label>
                <select 
                    id="language-select"
                    value={language}
                    onChange={(e) => onLanguageChange(e.target.value as 'en-US' | 'te-IN')}
                    className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="en-US">English</option>
                    <option value="te-IN">Telugu</option>
                </select>
            </div>
             <div className="space-y-2">
                <label htmlFor="topic-select" className="block text-sm font-medium text-gray-300">Topic to Focus</label>
                <select 
                    id="topic-select"
                    value={topic}
                    onChange={(e) => onTopicChange(e.target.value as 'general' | 'speech-therapy' | 'learn-english')}
                    className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                    <option value="general">General</option>
                    <option value="speech-therapy">Speech Therapy</option>
                    <option value="learn-english">Learn English</option>
                </select>
            </div>
        </div>

        <div className="p-2 border-t border-gray-600 mt-2">
            <button
                onClick={onNewChat}
                className="w-full flex items-center justify-center gap-2 p-2 rounded-md border border-gray-600 hover:bg-gray-700 transition-colors"
            >
                <PlusIcon className="w-5 h-5" />
                New Chat
            </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
            {conversations.map(convo => (
                <div key={convo.id} className="relative group">
                    {editingConversationId === convo.id ? (
                        <input
                            ref={inputRef}
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onBlur={handleSaveTitle}
                            onKeyDown={handleKeyDown}
                            className="w-full text-left p-2 rounded-md truncate bg-gray-600 text-white border border-blue-500 focus:outline-none"
                        />
                    ) : (
                        <a
                            href="#"
                            onClick={(e) => {
                                e.preventDefault();
                                onSelectConversation(convo.id);
                            }}
                            className={`block w-full text-left p-2 rounded-md truncate transition-colors pr-8 ${currentConversationId === convo.id ? 'bg-blue-600 text-white' : 'hover:bg-gray-700'}`}
                            title={convo.title}
                        >
                            {convo.title}
                        </a>
                    )}
                    {editingConversationId !== convo.id && (
                        <>
                            <button
                                onClick={() => setOpenMenuId(convo.id === openMenuId ? null : convo.id)}
                                className={`absolute right-1 top-1/2 -translate-y-1/2 p-1 rounded-full text-gray-400 hover:bg-gray-600 hover:text-white transition-opacity ${currentConversationId === convo.id ? '' : 'opacity-0 group-hover:opacity-100'}`}
                                aria-label="Conversation options"
                            >
                                <DotsVerticalIcon className="w-5 h-5" />
                            </button>
                            {openMenuId === convo.id && (
                                <div ref={menuRef} className="absolute right-0 top-full mt-1 w-32 bg-gray-900 border border-gray-700 rounded-md shadow-lg z-10 py-1">
                                    <button onClick={() => handleEdit(convo)} className="w-full text-left px-4 py-2 text-sm text-gray-200 hover:bg-gray-700">Edit</button>
                                    <button onClick={() => handleDelete(convo.id)} className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-700">Delete</button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            ))}
        </nav>
    </aside>
  );
};
