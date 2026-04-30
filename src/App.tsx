/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { 
  Sparkles, 
  Send, 
  Plus, 
  History, 
  Settings, 
  Search, 
  Menu, 
  X,
  User,
  Bot,
  Paperclip,
  Image as ImageIcon,
  Mic,
  LogOut,
  ChevronRight,
  MessageSquare,
  Loader2,
  Download,
  Brush,
  Wand2,
  Maximize2
} from "lucide-react";
import Markdown from "react-markdown";
import { cn } from "./lib/utils";
import { Message as GeminiMessage, chatStream } from "./services/gemini";
import { useAuth } from "./components/AuthProvider";
import { 
  collection, 
  query, 
  where, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  doc, 
  updateDoc,
  deleteDoc,
  limit,
  getDocs,
  getDocFromServer
} from "firebase/firestore";
import { db, auth } from "./lib/firebase";

// --- Firebase Error Handling ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Types ---
interface Chat {
  id: string;
  userId: string;
  title: string;
  lastMessage: string;
  updatedAt: any;
  createdAt: any;
}

interface MessageExtended extends GeminiMessage {
  imageUrl?: string;
  isImage?: boolean;
}

export default function App() {
  const { user, loading, signInWithGoogle, logout } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [chats, setChats] = useState<Chat[]>([]);
  const [messages, setMessages] = useState<MessageExtended[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [input]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load Chats
  useEffect(() => {
    if (!user) return;

    // Connection test
    const testConn = async () => {
      try {
        await getDocFromServer(doc(db, "_connection_test_", "ping"));
      } catch (e) {
        // Silent
      }
    };
    testConn();

    const q = query(
      collection(db, "chats"),
      where("userId", "==", user.uid),
      orderBy("updatedAt", "desc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const chatList = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Chat[];
      setChats(chatList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, "chats");
    });

    return () => unsubscribe();
  }, [user]);

  // Load Messages for Active Chat
  useEffect(() => {
    if (!activeChatId || !user) {
      setMessages([]);
      return;
    }

    const q = query(
      collection(db, "chats", activeChatId, "messages"),
      where("userId", "==", user.uid),
      orderBy("timestamp", "asc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const messageList = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          timestamp: data.timestamp?.toMillis ? data.timestamp.toMillis() : (data.timestamp || Date.now())
        };
      }) as MessageExtended[];
      setMessages(messageList);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `chats/${activeChatId}/messages`);
    });

    return () => unsubscribe();
  }, [activeChatId, user]);

  const createNewChat = async (initialMessage?: string) => {
    if (!user) return null;
    try {
      const chatData = {
        userId: user.uid,
        title: initialMessage ? (initialMessage.slice(0, 30) + "...") : "محادثة جديدة",
        lastMessage: initialMessage || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      const docRef = await addDoc(collection(db, "chats"), chatData);
      setActiveChatId(docRef.id);
      return docRef.id;
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, "chats");
      return null;
    }
  };

  const handleGenerateImage = async () => {
    if (!input.trim() || isGeneratingImage || !user) return;

    let chatId = activeChatId;
    const prompt = input;
    setInput("");

    if (!chatId) {
      chatId = await createNewChat(prompt);
      if (!chatId) return;
    }

    setIsGeneratingImage(true);
    setIsTyping(true);

    try {
      // Save User Message
      await addDoc(collection(db, "chats", chatId, "messages"), {
        userId: user.uid,
        role: "user",
        text: `توليد صورة: ${prompt}`,
        timestamp: serverTimestamp()
      });

      // Generate Image URL (using pollinations.ai)
      // We'll use a seed to make it more reliable and interesting
      const seed = Math.floor(Math.random() * 1000000);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${seed}&width=1024&height=1024&nologo=true`;

      // Save Model Message with Image
      await addDoc(collection(db, "chats", chatId, "messages"), {
        userId: user.uid,
        role: "model",
        text: `تم توليد الصورة بناءً على طلبك: "${prompt}"`,
        imageUrl: imageUrl,
        isImage: true,
        timestamp: serverTimestamp()
      });

      // Update Chat record
      await updateDoc(doc(db, "chats", chatId), {
        lastMessage: "تم توليد صورة",
        updatedAt: serverTimestamp()
      });

    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `chats/${chatId}/messages`);
    } finally {
      setIsGeneratingImage(false);
      setIsTyping(false);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isTyping || !user) return;

    let chatId = activeChatId;
    const userInput = input;
    setInput("");

    if (!chatId) {
      chatId = await createNewChat(userInput);
      if (!chatId) return;
    }

    try {
      // Save User Message
      await addDoc(collection(db, "chats", chatId, "messages"), {
        userId: user.uid,
        role: "user",
        text: userInput,
        timestamp: serverTimestamp()
      });

      // Update Chat record
      await updateDoc(doc(db, "chats", chatId), {
        lastMessage: userInput,
        updatedAt: serverTimestamp()
      });

      setIsTyping(true);

      // Prepare history for Gemini
      const chatMessages = messages.concat({
        id: "temp-user",
        role: "user",
        text: userInput,
        timestamp: Date.now()
      });

      let assistantText = "";
      const stream = chatStream(chatMessages);
      
      // Temporary message ID for streaming
      const assistantId = "streaming-temp";
      
      // We'll update the final message at the end
      for await (const chunk of stream) {
        assistantText += chunk;
        // Optimization: Local state update for smooth streaming
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.id === assistantId) {
            return [...prev.slice(0, -1), { ...last, text: assistantText }];
          } else {
            return [...prev, { id: assistantId, role: "model", text: assistantText, timestamp: Date.now() }];
          }
        });
      }

      // Save Assistant Message
      await addDoc(collection(db, "chats", chatId, "messages"), {
        userId: user.uid,
        role: "model",
        text: assistantText,
        timestamp: serverTimestamp()
      });

    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `chats/${chatId}/messages`);
    } finally {
      setIsTyping(false);
    }
  };

  useEffect(() => {
    const handleUpdateInput = (e: any) => setInput(e.detail);
    window.addEventListener('updateInput', handleUpdateInput);
    return () => window.removeEventListener('updateInput', handleUpdateInput);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-full bg-black flex items-center justify-center">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
        >
          <Sparkles className="w-10 h-10 text-gold-500" />
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return <LoginScreen onLogin={signInWithGoogle} />;
  }

  return (
    <div className="flex h-screen w-full bg-black overflow-hidden text-neutral-100 font-sans relative">
      <DragonBackground />
      
      {/* Sidebar Overlay */}
      <AnimatePresence>
        {!isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(true)}
            className="fixed inset-0 bg-black/80 z-20 md:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside
        initial={false}
        animate={{ 
          width: isSidebarOpen ? "280px" : "0px",
          marginRight: isSidebarOpen ? "0px" : "-280px",
        }}
        className="relative bg-black/40 backdrop-blur-3xl border-l border-white/5 flex flex-col z-30 overflow-hidden"
      >
        <div className="p-4 flex flex-col h-full w-[280px]">
          <button 
            onClick={() => {
              setActiveChatId(null);
              setMessages([]);
            }}
            className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-gold-500/10 hover:bg-gold-500/20 transition-all w-full text-sm font-bold mb-6 mt-2 border border-gold-500/20 shadow-[0_0_15px_rgba(251,191,36,0.05)]"
          >
            <Plus className="w-4 h-4 text-gold-500" />
            <span className="text-gold-500">محادثة جديدة</span>
          </button>

          <div className="flex-1 overflow-y-auto space-y-2 scroll-smooth">
            <p className="text-[10px] uppercase tracking-widest text-neutral-600 font-bold mb-4 pr-2">المحادثات السابقة</p>
            {chats.map(chat => (
              <button 
                key={chat.id}
                onClick={() => setActiveChatId(chat.id)}
                className={cn(
                  "w-full text-right p-3 rounded-xl transition-all text-sm group flex items-center justify-between",
                  activeChatId === chat.id 
                    ? "bg-white/10 text-gold-500 border border-white/10" 
                    : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquare className={cn("w-3.5 h-3.5 shrink-0", activeChatId === chat.id ? "text-gold-500" : "text-neutral-600")} />
                  <span className="truncate">{chat.title}</span>
                </div>
                {activeChatId === chat.id && <div className="w-1 h-1 rounded-full bg-gold-500 animate-pulse" />}
              </button>
            ))}
            {chats.length === 0 && (
               <div className="flex flex-col items-center justify-center p-8 opacity-20 text-center">
                 <History className="w-6 h-6 mb-2" />
                 <p className="text-[10px]">لا توجد سجلات</p>
               </div>
            )}
          </div>

          <div className="pt-4 border-t border-white/5 mt-auto space-y-2">
            <div className="px-1 py-2">
              <div className="flex items-center gap-3 p-2 rounded-xl bg-gold-500/5 border border-gold-500/10">
                <img src={user.photoURL || ""} alt={user.displayName || ""} className="w-8 h-8 rounded-lg shadow-lg" />
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-bold text-gold-500 truncate">{user.displayName}</span>
                  <button onClick={logout} className="text-[9px] text-neutral-500 hover:text-red-400 flex items-center gap-1 transition-colors">
                    <LogOut className="w-2.5 h-2.5" />
                    تسجيل الخروج
                  </button>
                </div>
              </div>
            </div>
            <SidebarItem icon={<Settings className="w-4 h-4" />} label="الإعدادات" />
          </div>
        </div>
      </motion.aside>

      {/* Main Area */}
      <main className="flex-1 flex flex-col relative min-w-0 h-full">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-4 md:px-8 border-b border-white/5 bg-black/20 backdrop-blur-sm z-10 transition-all">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors text-neutral-500 hover:text-gold-500"
            >
              {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg tracking-tight bg-gradient-to-l from-gold-500 to-amber-600 bg-clip-text text-transparent">muntadher.asd</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <button className="p-2 hover:bg-white/5 rounded-full transition-colors text-neutral-500">
               <Search className="w-5 h-5" />
             </button>
             <div className="w-8 h-8 rounded-full overflow-hidden border border-gold-500/20 p-0.5">
                <img src={user.photoURL || ""} className="w-full h-full rounded-full" alt="profile" />
             </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-8 md:px-0 scroll-smooth">
          <div className="max-w-3xl mx-auto w-full space-y-10 pb-10">
            {!activeChatId && messages.length === 0 ? (
              <WelcomeScreen onPromptClick={(p) => setInput(p)} />
            ) : (
              messages.map((msg, idx) => (
                <ChatMessage 
                  key={msg.id} 
                  message={msg} 
                  isLast={idx === messages.length - 1} 
                  onImageClick={() => msg.imageUrl && setPreviewImage(msg.imageUrl)}
                />
              ))
            )}
            {isTyping && messages[messages.length - 1]?.role === "user" && (
               <div className="flex gap-4 md:gap-6 animate-pulse">
                 <div className="w-8 h-8 rounded-full bg-gold-600 flex items-center justify-center shrink-0">
                   <Bot className="w-4 h-4" />
                 </div>
                 <div className="w-12 h-6 bg-white/5 rounded-lg" />
               </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input */}
        <div className="p-4 md:pb-8">
          <div className="max-w-3xl mx-auto">
            <div className="relative flex items-end gap-2 bg-neutral-900/60 backdrop-blur-3xl border border-white/5 focus-within:border-gold-500/30 rounded-[28px] p-2 pr-4 transition-all shadow-2xl">
              <div className="flex items-center gap-1 pb-1">
                <InputButton 
                  icon={isGeneratingImage ? <Loader2 className="w-5 h-5 animate-spin" /> : <Brush className="w-5 h-5" />} 
                  onClick={handleGenerateImage}
                  disabled={isGeneratingImage || !input.trim()}
                  tooltip="توليد صورة"
                />
                <InputButton icon={<Paperclip className="w-5 h-5" />} />
              </div>
              
              <textarea 
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="تحدث معي بأي شيء..."
                rows={1}
                className="flex-1 bg-transparent border-none focus:ring-0 resize-none py-3 text-neutral-200 placeholder-neutral-600 min-h-[52px] max-h-[300px] text-sm md:text-base"
              />

              <div className="flex items-center gap-1 pb-1">
                {input ? (
                  <motion.button
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    onClick={handleSend}
                    disabled={isTyping}
                    className="p-3 rounded-full bg-gold-500 text-black hover:bg-gold-400 transition-all disabled:opacity-50 shadow-lg shadow-gold-500/40"
                  >
                    <Send className="w-5 h-5" />
                  </motion.button>
                ) : (
                  <InputButton icon={<Mic className="w-5 h-5" />} />
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Lightbox Preview */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewImage(null)}
            className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-3xl flex items-center justify-center p-4 md:p-12 cursor-zoom-out"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="relative max-w-5xl w-full h-full flex flex-col items-center justify-center gap-6"
            >
              <div className="absolute top-0 right-0 p-4 md:p-8 flex gap-4 z-[110]">
                 <a 
                   href={previewImage} 
                   download="image.jpg"
                   className="p-3 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-md transition-all text-white border border-white/10 group"
                   title="تحميل"
                 >
                   <Download className="w-6 h-6 group-hover:scale-110 transition-transform" />
                 </a>
                 <button 
                   onClick={() => setPreviewImage(null)}
                   className="p-3 bg-white/10 hover:bg-white/20 rounded-full backdrop-blur-md transition-all text-white border border-white/10 group"
                   title="إغلاق"
                 >
                   <X className="w-6 h-6 group-hover:scale-110 transition-transform" />
                 </button>
              </div>

              <div className="relative w-full h-full flex items-center justify-center group/viewer">
                <img 
                  src={previewImage} 
                  alt="Preview" 
                  className="max-w-full max-h-full object-contain rounded-2xl shadow-[0_0_100px_rgba(251,191,36,0.1)] border border-white/5 select-none"
                  referrerPolicy="no-referrer"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
  return (
    <div className="h-screen w-full bg-black flex flex-col items-center justify-center relative overflow-hidden font-sans">
      <DragonBackground />
      <motion.div 
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md px-6 z-10 text-center space-y-8"
      >
        <div className="space-y-4">
          <motion.div 
            animate={{ 
              filter: ["drop-shadow(0 0 10px rgba(251,191,36,0))", "drop-shadow(0 0 20px rgba(251,191,36,0.3))", "drop-shadow(0 0 10px rgba(251,191,36,0))"]
            }}
            transition={{ repeat: Infinity, duration: 4 }}
            className="w-24 h-24 bg-gradient-to-br from-gold-500 to-amber-600 rounded-[2.5rem] mx-auto flex items-center justify-center shadow-2xl"
          >
            <Sparkles className="w-12 h-12 text-black" />
          </motion.div>
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-white mb-2">muntadher.asd</h1>
            <p className="text-neutral-500 text-sm">مساعدك الذكي المستقبلي</p>
          </div>
        </div>

        <div className="space-y-4">
          <button 
            onClick={onLogin}
            className="w-full py-4 rounded-2xl bg-white text-black font-bold flex items-center justify-center gap-3 hover:bg-neutral-200 transition-all group scale-100 hover:scale-[1.02]"
          >
            <img src="https://www.google.com/favicon.ico" className="w-5 h-5" alt="google" />
            <span>تسجيل الدخول باستخدام Google</span>
            <ChevronRight className="w-4 h-4 group-hover:translate-x-[-4px] transition-transform" />
          </button>
          
          <p className="text-[11px] text-neutral-600 px-8">
            بتسجيل الدخول، فإنك توافق على تجربة ذكاء اصطناعي مخصصة ومدعومة بأحدث التقنيات.
          </p>
        </div>

        <div className="pt-10 flex items-center justify-center gap-6 opacity-30 grayscale saturate-0">
          <div className="h-[1px] w-12 bg-white" />
          <span className="text-[10px] text-white font-bold tracking-widest uppercase">Safe & Secure</span>
          <div className="h-[1px] w-12 bg-white" />
        </div>
      </motion.div>
    </div>
  );
}

function DragonBackground() {
  return (
    <div className="dragon-bg select-none pointer-events-none">
      <div className="dragon-container">
        <svg className="dragon-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
          {/* Detailed Dragon silhouette */}
          <path 
            d="M100,20 C120,20 140,40 140,70 C140,100 120,120 100,120 C80,120 60,100 60,70 C60,40 80,20 100,20 M140,70 Q180,70 180,110 Q180,150 140,150 Q100,150 80,180 Q60,150 20,150 Q-20,150 20,110 Q20,70 60,70" 
            fill="none" 
            stroke="currentColor" 
            strokeWidth="1" 
            opacity="0.5" 
          />
          <path d="M100,30 Q110,40 100,50 Q90,40 100,30" fill="currentColor" />
          <path d="M140,70 L160,50 M140,80 L165,75 M140,90 L160,100" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M60,70 L40,50 M60,80 L35,75 M60,90 L40,100" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      {[...Array(40)].map((_, i) => (
        <div 
          key={i}
          className="gold-ember"
          style={{
            left: `${Math.random() * 100}%`,
            bottom: `-20px`,
            width: `${1 + Math.random() * 2}px`,
            height: `${1 + Math.random() * 2}px`,
            animation: `float ${6 + Math.random() * 12}s linear infinite`,
            animationDelay: `${-Math.random() * 20}s`
          }}
        />
      ))}
    </div>
  );
}

function SidebarItem({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-neutral-800/80 transition-all text-sm text-neutral-400 hover:text-neutral-200"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function InputButton({ icon, onClick, disabled, tooltip }: { icon: React.ReactNode, onClick?: () => void, disabled?: boolean, tooltip?: string }) {
  return (
    <button 
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={cn(
        "p-2.5 rounded-full transition-colors text-neutral-500 hover:text-neutral-300 disabled:opacity-30 disabled:cursor-not-allowed",
        !disabled && "hover:bg-white/5"
      )}
    >
      {icon}
    </button>
  );
}

function ChatMessage({ message, isLast, onImageClick }: { message: MessageExtended, isLast: boolean, onImageClick: () => void }) {
  const isUser = message.role === "user";

  const setInput = (text: string) => {
    // This is a workaround since setInput is in the parent. 
    // Usually we would pass it down, but for brevity we'll just handle it in the parent or use a custom event.
    window.dispatchEvent(new CustomEvent('updateInput', { detail: text }));
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "flex gap-4 md:gap-6",
        isUser ? "flex-row-reverse" : "flex-row"
      )}
    >
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center shrink-0 border shadow-lg",
        isUser ? "bg-neutral-800 border-white/10" : "bg-gold-500 border-gold-400"
      )}>
        {isUser ? <User className="w-4 h-4 text-neutral-400" /> : <Bot className="w-4 h-4 text-black" />}
      </div>
      
      <div className={cn(
        "flex flex-col min-w-0 max-w-[85%]",
        isUser ? "items-end text-left" : "items-start text-right"
      )}>
        <p className="text-[10px] text-neutral-550 font-bold mb-1 uppercase tracking-tighter opacity-50">
          {isUser ? "You" : "muntadher.asd"}
        </p>
        <div className={cn(
          "rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm",
          isUser ? "bg-white/5 text-neutral-200 rounded-tr-none border border-white/5" : "markdown-body bg-neutral-900/40 backdrop-blur-sm border border-gold-500/10"
        )}>
          {message.imageUrl ? (
            <div className="space-y-4">
              <div 
                className="relative group cursor-zoom-in overflow-hidden rounded-xl border border-white/10 shadow-2xl"
                onClick={onImageClick}
              >
                <img 
                  src={message.imageUrl} 
                  alt={message.text || "Generated"} 
                  className="w-full max-w-sm transition-transform duration-500 hover:scale-105"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gold-500/10 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                   <div className="p-3 bg-black/40 backdrop-blur-xl rounded-full translate-y-4 group-hover:translate-y-0 transition-transform duration-300">
                     <Maximize2 className="w-6 h-6 text-white" />
                   </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1 border-t border-white/5">
                 <button 
                   onClick={() => setInput(`عدّل هذه الصورة لتصبح: ${message.text?.split(': ')[1] || ""}`)}
                   className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-gold-500/10 hover:bg-gold-500/20 text-gold-500 transition-colors text-[10px] uppercase font-bold"
                 >
                   <Wand2 className="w-3 h-3" />
                   تعديل الوصف
                 </button>
                 <a 
                   href={message.imageUrl} 
                   download="generated.jpg"
                   className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-neutral-400 hover:text-white transition-colors text-[10px] uppercase font-bold"
                 >
                   <Download className="w-3 h-3" />
                   تحميل
                 </a>
              </div>
              <Markdown>{message.text || ""}</Markdown>
            </div>
          ) : (
            isUser ? (
              <p className="whitespace-pre-wrap">{message.text}</p>
            ) : (
              <Markdown>{message.text || "..."}</Markdown>
            )
          )}
        </div>
      </div>
    </motion.div>
  );
}

function WelcomeScreen({ onPromptClick }: { onPromptClick: (p: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-12 py-10">
      <div className="text-center space-y-3">
        <motion.div 
          initial={{ scale: 0.8 }}
          animate={{ scale: 1 }}
          className="w-16 h-16 bg-gradient-to-br from-gold-500 to-amber-600 rounded-3xl mx-auto flex items-center justify-center shadow-2xl shadow-gold-500/20"
        >
          <Sparkles className="w-8 h-8 text-black" />
        </motion.div>
        <h1 className="text-4xl font-bold tracking-tight bg-gradient-to-l from-white to-neutral-500 bg-clip-text text-transparent pt-4">كيف أساعدك اليوم؟</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 w-full max-w-2xl px-4">
        <PromptCard 
          title="برمجة" 
          desc="اكتب لي دالة لفرز قائمة في بايثون" 
          onClick={() => onPromptClick("اكتب لي دالة لفرز قائمة في بايثون مع شرح بسيط.")}
        />
        <PromptCard 
          title="ترجمة" 
          desc="ترجم هذه الجملة إلى الإنجليزية" 
          onClick={() => onPromptClick("ترجم هذه الجملة إلى الإنجليزية: 'الذكاء الاصطناعي هو مستقبل التكنولوجيا'.")}
        />
        <PromptCard 
          title="نصيحة" 
          desc="كيف أتحسن في البرمجة؟" 
          onClick={() => onPromptClick("أعطني نصائح عملية للتحسن في مجال تطوير الويب.")}
        />
        <PromptCard 
          title="إبداع" 
          desc="اكتب قصة قصيرة عن الفضاء" 
          onClick={() => onPromptClick("اكتب قصة قصيرة ومشوقة عن أول إنسان يصل إلى مجرة أخرى.")}
        />
      </div>
    </div>
  );
}

function PromptCard({ title, desc, onClick }: { title: string, desc: string, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className="p-5 rounded-2xl bg-white/5 border border-white/5 hover:border-gold-500/20 hover:bg-gold-500/5 transition-all text-right group animate-in fade-in slide-in-from-bottom-2 duration-500"
    >
      <p className="text-sm font-bold text-neutral-200 mb-1 group-hover:text-gold-500 transition-colors tracking-tight">{title}</p>
      <p className="text-xs text-neutral-500 leading-relaxed font-medium">{desc}</p>
    </button>
  );
}
