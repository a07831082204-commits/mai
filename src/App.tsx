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

  // التعديل المطلوب: مراقبة حالة المستخدم لضمان تحديث الواجهة فوراً
  useEffect(() => {
    if (user && !loading) {
      console.log("تم اكتشاف المستخدم بنجاح:", user.displayName);
    }
  }, [user, loading]);

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
      await addDoc(collection(db, "chats", chatId, "messages"), {
        userId: user.uid,
        role: "user",
        text: `توليد صورة: ${prompt}`,
        timestamp: serverTimestamp()
      });

      const seed = Math.floor(Math.random() * 1000000);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?seed=${seed}&width=1024&height=1024&nologo=true`;

      await addDoc(collection(db, "chats", chatId, "messages"), {
        userId: user.uid,
        role: "model",
        text: `تم توليد الصورة بناءً على طلبك: "${prompt}"`,
        imageUrl: imageUrl,
        isImage: true,
        timestamp: serverTimestamp()
      });

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
      await addDoc(collection(db, "chats", chatId, "messages"), {
        userId: user.uid,
        role: "user",
        text: userInput,
        timestamp: serverTimestamp()
      });

      await updateDoc(doc(db, "chats", chatId), {
        lastMessage: userInput,
        updatedAt: serverTimestamp()
      });

      setIsTyping(true);

      const chatMessages = messages.concat({
        id: "temp-user",
        role: "user",
        text: userInput,
        timestamp: Date.now()
      });

      let assistantText = "";
      const stream = chatStream(chatMessages);
      
      const assistantId = "streaming-temp";
      
      for await (const chunk of stream) {
        assistantText += chunk;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.id === assistantId) {
            return [...prev.slice(0, -1), { ...last, text: assistantText }];
          } else {
            return [...prev, { id: assistantId, role: "model", text: assistantText, timestamp: Date.now() }];
          }
        });
      }

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
    // تم التأكد من تمرير دالة تسجيل الدخول بشكل صحيح
    return <LoginScreen onLogin={signInWithGoogle} />;
  }

  return (
    <div className="flex h-screen w-full bg-black overflow-hidden text-neutral-100 font-sans relative">
      <DragonBackground />
      
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

      <main className="flex-1 flex flex-col relative min-w-0 h-full">
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
                  className="max-w-full max-h-full object-contain rounded-2xl shadow-2xl"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
            }
                  
