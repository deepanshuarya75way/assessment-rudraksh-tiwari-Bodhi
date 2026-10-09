import { useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";

import {
  Plus,
  Send,
  Image as ImageIcon,
  Moon,
  Sun,
  MessageSquare,
  Sparkles,
  ScanSearch,
  Menu,
  X,
  Trash2,
} from "lucide-react";

import "../styles/chat.css";

// =========================================================
// SOCKET
// =========================================================

const savedUser = JSON.parse(localStorage.getItem("user")||"null")
const userId = savedUser?._id||savedUser?.id||savedUser?.userId;

const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL || "https://bodhi-5wnm.onrender.com/";

// =========================================================
// MODES
// =========================================================

const MODES = {
  text: {
    label: "Text Understanding",
    shortLabel: "Text",
    icon: MessageSquare,
  },

  generation: {
    label: "Image Generation",
    shortLabel: "Generate",
    icon: Sparkles,
  },

  understanding: {
    label: "Image Understanding",
    shortLabel: "Vision",
    icon: ScanSearch,
  },
};

function ChatWindow() {
  // =======================================================
  // STATE
  // =======================================================

  const [socket, setSocket] = useState(null);

  const [messages, setMessages] = useState([]);

  const [input, setInput] = useState("");

  const [activeMode, setActiveMode] = useState("text");

  const [selectedImage, setSelectedImage] = useState(null);

  const [imagePreview, setImagePreview] = useState(null);

  const [isGenerating, setIsGenerating] = useState(false);

  const [darkMode, setDarkMode] = useState(false);

  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    return window.innerWidth >= 901;
  });

  const [chatId, setChatId] = useState(null);

  const [chatTitle, setChatTitle] = useState("New Chat");

  const [chats, setChats] = useState([]);

  const fileInputRef = useRef(null);

  const messagesEndRef = useRef(null);

  const sidebarRef = useRef(null);

  // =======================================================
  // SOCKET CONNECTION
  // =======================================================

  useEffect(() => {
    const newSocket = io(SOCKET_URL, {
      withCredentials: true,
      transports: ["websocket"],
    });

    setSocket(newSocket);

    // =====================================================
    // AI RESPONSE
    // =====================================================

    newSocket.on("ai-response", (data) => {
      console.log("AI Response:", data);

      setIsGenerating(false);

      setMessages((prev) => [
        ...prev,

        {
          id: Date.now(),

          role: "model",

          type: data.type || "text",

          content: data.content,

          imageUrl: data.imageUrl || null,
        },
      ]);
    });

    // =====================================================
    // AI ERROR
    // =====================================================

    newSocket.on("ai-error", (data) => {
      console.error("AI Error:", data);

      setIsGenerating(false);

      setMessages((prev) => [
        ...prev,

        {
          id: Date.now(),

          role: "model",

          type: "error",

          content: data?.message || "Something went wrong.",
        },
      ]);
    });

    newSocket.on("connect_error", (error) => {
      console.error("Socket connection error:", error.message);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // =======================================================
  // AUTO SCROLL
  // =======================================================

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: "smooth",
    });
  }, [messages, isGenerating]);

  // =======================================================
  // CREATE NEW CHAT
  // =======================================================

  async function createNewChat() {
    try {
      const title = window.prompt("Enter a title for this chat:");

      if (!title?.trim()) {
        return;
      }

      if (window.innerWidth <= 900) {
        setSidebarOpen(false);
      }

      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/chat`, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
        },

        credentials: "include",

        body: JSON.stringify({
          title: title.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to create chat");
      }

      const newChat = {
        id: data.chatId,

        title: title.trim(),

        date: new Date(),
      };

      setChats((prev) => {
        const nextChats = [newChat, ...prev];
        localStorage.setItem("bodhi_chat_list", JSON.stringify(nextChats));
        return nextChats;
      });

      setChatId(data.chatId);

      setChatTitle(title.trim());

      setMessages([]);
    } catch (error) {
      console.error("Create Chat Error:", error);

      alert(error.message);
    }
  }

  // =======================================================
  // SELECT CHAT
  // =======================================================

  async function selectChat(chat) {
    setChatId(chat.id);

    setChatTitle(chat.title);

    if (window.innerWidth <= 900) {
      setSidebarOpen(false);
    }

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/api/chat/${chat.id}/messages`,
        {
          method: "GET",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to load chat history");
      }

      const loadedMessages = (data.messages || []).map((message) => ({
        id: message.id,
        role: message.role,
        type: message.type,
        content: message.content,
        prompt:
          message.mode === "image-understanding" && message.role === "user"
            ? message.content
            : undefined,
        imageUrl: message.type === "image" ? message.content : null,
      }));

      setMessages(loadedMessages);
    } catch (error) {
      console.error("Load chat messages error:", error);
      setMessages([]);
    }
  }

  // =======================================================
  // MODE CHANGE
  // =======================================================

  function changeMode(mode) {
    setActiveMode(mode);

    setSelectedImage(null);

    setImagePreview(null);

    setInput("");
  }

  // =======================================================
  // IMAGE SELECT
  // =======================================================

  function handleImageSelect(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    // Only image files
    if (!file.type.startsWith("image/")) {
      alert("Please select an image.");

      return;
    }

    setSelectedImage(file);

    setImagePreview(URL.createObjectURL(file));
  }

  // =======================================================
  // REMOVE IMAGE
  // =======================================================

  function removeSelectedImage(revokeCurrent = true) {
    if (revokeCurrent && imagePreview) {
      URL.revokeObjectURL(imagePreview);
    }

    setSelectedImage(null);
    setImagePreview(null);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  // =======================================================
  // FILE → BASE64
  // =======================================================

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => {
        const result = reader.result;

        // Remove:
        // data:image/png;base64,
        //
        // Backend expects pure base64.

        const base64 = result.split(",")[1];

        resolve(base64);
      };

      reader.onerror = reject;

      reader.readAsDataURL(file);
    });
  }

  // =======================================================
  // SEND MESSAGE
  // =======================================================

  async function sendMessage() {
    if (!socket) {
      return;
    }

    // =====================================================
    // CHAT REQUIRED
    // =====================================================

    if (!chatId) {
      alert("Please create a chat first.");

      return;
    }

    // =====================================================
    // IMAGE UNDERSTANDING
    // =====================================================

    if (activeMode === "understanding") {
      if (!selectedImage) {
        alert("Please select an image.");

        return;
      }

      try {
        setIsGenerating(true);

        const base64 = await fileToBase64(selectedImage);
        const uploadedPreviewUrl = imagePreview;

        // ===============================================
        // SHOW USER MESSAGE
        // ===============================================

        setMessages((prev) => [
          ...prev,

          {
            id: Date.now(),

            role: "user",

            type: "image",

            content: uploadedPreviewUrl,

            prompt: input.trim(),
          },
        ]);

        // ===============================================
        // EXACT BACKEND PAYLOAD
        // ===============================================

        socket.emit("ai-message", {
          chat: chatId,

          type: "image",

          mode: "image-understanding",

          content: base64,

          mimeType: selectedImage.type,

          prompt: input.trim(),
        });

        setInput("");
        setSelectedImage(null);
        setImagePreview(null);

        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      } catch (error) {
        console.error("Image send error:", error);

        setIsGenerating(false);
      }

      return;
    }

    // =====================================================
    // TEXT / IMAGE GENERATION
    // =====================================================

    const content = input.trim();

    if (!content) {
      return;
    }

    setIsGenerating(true);

    // =====================================================
    // SHOW USER MESSAGE
    // =====================================================

    setMessages((prev) => [
      ...prev,

      {
        id: Date.now(),

        role: "user",

        type: "text",

        content,

        mode: activeMode === "generation" ? "image-generation" : "chat",
      },
    ]);

    // =====================================================
    // TEXT UNDERSTANDING
    // =====================================================

    if (activeMode === "text") {
      socket.emit("ai-message", {
        chat: chatId,

        type: "text",

        mode: "chat",

        content,
      });
    }

    // =====================================================
    // IMAGE GENERATION
    // =====================================================

    if (activeMode === "generation") {
      socket.emit("ai-message", {
        chat: chatId,

        type: "text",

        mode: "image-generation",

        content,
      });
    }

    setInput("");
  }

  // =======================================================
  // ENTER KEY
  // =======================================================

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();

      sendMessage();
    }
  }

  // =======================================================
  // MODE ICON
  // =======================================================

  const ActiveIcon = MODES[activeMode].icon;

  // =======================================================
  // LOAD CHATS
  // =======================================================

  async function loadChats() {
    try {
      const response = await fetch(`${import.meta.env.VITE_API_URL}/api/chat`, {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to load chats");
      }

      const savedChats = (data.chats || []).map((chat) => ({
        id: chat._id,
        title: chat.title,
        date: chat.lastActivity || chat.createdAt || Date.now(),
      }));

      setChats(savedChats);
      localStorage.setItem("bodhi_chat_list", JSON.stringify(savedChats));
    } catch (error) {
      console.warn("Chat load failed:", error.message);

      const cachedChats = localStorage.getItem("bodhi_chat_list");

      if (cachedChats) {
        try {
          setChats(JSON.parse(cachedChats));
        } catch {
          setChats([]);
        }
      }
    }
  }

  useEffect(() => {
    loadChats();
  }, []);

  useEffect(() => {
    if (chats.length > 0) {
      localStorage.setItem("bodhi_chat_list", JSON.stringify(chats));
    } else {
      localStorage.removeItem("bodhi_chat_list");
    }
  }, [chats]);

  // =======================================================
  // DELETE CHAT
  // =======================================================

  async function deleteChat(chatIdToDelete) {
    if (!chatIdToDelete) {
      return;
    }

    const confirmed = window.confirm("Delete this chat?");

    if (!confirmed) {
      return;
    }

    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL}/api/chat/${chatIdToDelete}`,
        {
          method: "DELETE",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Unable to delete chat");
      }

      setChats((prev) => {
        const nextChats = prev.filter((chat) => chat.id !== chatIdToDelete);
        localStorage.setItem("bodhi_chat_list", JSON.stringify(nextChats));
        return nextChats;
      });

      if (chatId === chatIdToDelete) {
        setChatId(null);
        setChatTitle("New Chat");
        setMessages([]);
      }
    } catch (error) {
      console.error("Delete Chat Error:", error);
      alert(error.message);
    }
  }

  // =======================================================
  // RENDER
  // =======================================================

  return (
    <div className={`chat-app ${darkMode ? "dark" : "light"}`}>
      {typeof window !== "undefined" && window.innerWidth <= 900 && (
        <div
          className={`sidebar-backdrop ${sidebarOpen ? "show" : ""}`}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ================================================= */}
      {/* SIDEBAR */}
      {/* ================================================= */}

      <aside
        ref={sidebarRef}
        className={`sidebar ${sidebarOpen ? "open" : "closed"}`}
      >
        {/* BRAND */}

        <div className="brand">
          <div className="brand-logo">B</div>

          <div>
            <h2>
              Bodhi
              <span> AI</span>
            </h2>

            <p>Intelligent Assistant</p>
          </div>
        </div>

        {/* NEW CHAT */}

        <button className="new-chat-btn" onClick={createNewChat}>
          <Plus size={19} />

          <span>New Chat</span>
        </button>

        {/* MODES */}

        <div className="mode-section">
          <p className="section-label">MODES</p>

          <button
            className={`mode-btn ${activeMode === "text" ? "active" : ""}`}
            onClick={() => changeMode("text")}
          >
            <MessageSquare size={18} />

            <span>Text Understanding</span>
          </button>

          <button
            className={`mode-btn ${
              activeMode === "generation" ? "active" : ""
            }`}
            onClick={() => changeMode("generation")}
          >
            <Sparkles size={18} />

            <span>Image Generation</span>
          </button>

          <button
            className={`mode-btn ${
              activeMode === "understanding" ? "active" : ""
            }`}
            onClick={() => changeMode("understanding")}
          >
            <ScanSearch size={18} />

            <span>Image Understanding</span>
          </button>
        </div>

        {/* CHATS */}

        <div className="chat-list-section">
          <p className="section-label">CHATS</p>

          <div className="chat-list">
            {chats.length === 0 ? (
              <div className="empty-chats">
                <MessageSquare size={18} />

                <span>No chats yet</span>
              </div>
            ) : (
              chats.map((chat) => (
                <div key={chat.id} className="chat-item-wrapper">
                  <button
                    className={`chat-item ${
                      chatId === chat.id ? "selected" : ""
                    }`}
                    onClick={() => selectChat(chat)}
                  >
                    <MessageSquare size={17} />

                    <div>
                      <strong>{chat.title}</strong>

                      <small>{new Date(chat.date).toLocaleDateString()}</small>
                    </div>
                  </button>

                  <button
                    className="chat-delete-btn"
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteChat(chat.id);
                    }}
                    title="Delete chat"
                    aria-label={`Delete ${chat.title}`}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* SIDEBAR FOOTER */}

        <div className="sidebar-footer">
          <div className="user-avatar">U</div>

          <div className="user-info">
            <strong>Bodhi User</strong>

            <small>AI Workspace</small>
          </div>
        </div>
      </aside>

      {/* ================================================= */}
      {/* MAIN */}
      {/* ================================================= */}

      <main className="main-area">
        {/* TOP BAR */}

        <header className="top-bar">
          <button
            className="mobile-menu"
            onClick={() => setSidebarOpen(!sidebarOpen)}
          >
            {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>

          <div className="current-mode">
            <ActiveIcon size={18} />

            <span>{MODES[activeMode].label}</span>
          </div>

          {/* THEME BUTTON */}

          <button
            className="theme-toggle"
            onClick={() => setDarkMode(!darkMode)}
            title="Change theme"
          >
            {darkMode ? <Sun size={19} /> : <Moon size={19} />}
          </button>
        </header>

        {/* ================================================= */}
        {/* MESSAGE AREA */}
        {/* ================================================= */}

        <section className="messages-area">
          {messages.length === 0 ? (
            <div className="welcome">
              <div className="welcome-logo">
                <Sparkles size={34} />
              </div>

              <h1>
                Start a<span> conversation</span>
              </h1>

              <p>Ask me anything and I'll help you out!</p>

              <div className="mode-cards">
                <button onClick={() => changeMode("text")}>
                  <MessageSquare size={27} />

                  <strong>Text Understanding</strong>

                  <span>
                    Ask questions, explain code, solve problems and more.
                  </span>
                </button>

                <button onClick={() => changeMode("generation")}>
                  <Sparkles size={27} />

                  <strong>Image Generation</strong>

                  <span>Create images from your imagination.</span>
                </button>

                <button onClick={() => changeMode("understanding")}>
                  <ScanSearch size={27} />

                  <strong>Image Understanding</strong>

                  <span>Upload an image and ask questions about it.</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="messages-container">
              {messages.map((message) => (
                <div key={message.id} className={`message-row ${message.role}`}>
                  <div className="message-avatar">
                    {message.role === "user" ? "U" : "B"}
                  </div>

                  <div className="message-content">
                    {message.type === "image" ? (
                      <div>
                        <img
                          src={message.content}
                          className="chat-image"
                          alt="uploaded"
                        />

                        {message.prompt && (
                          <p className="image-prompt">{message.prompt}</p>
                        )}
                      </div>
                    ) : message.type === "error" ? (
                      <div className="error-message">{message.content}</div>
                    ) : (
                      <div className="text-message">{message.content}</div>
                    )}
                  </div>
                </div>
              ))}

              {isGenerating && (
                <div className="message-row model">
                  <div className="message-avatar">B</div>

                  <div className="typing">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </section>

        {/* ================================================= */}
        {/* IMAGE PREVIEW */}
        {/* ================================================= */}

        {imagePreview && (
          <div className="image-preview-wrapper">
            <div className="image-preview">
              <img src={imagePreview} alt="preview" />

              <button onClick={removeSelectedImage}>
                <X size={15} />
              </button>
            </div>
          </div>
        )}

        {/* ================================================= */}
        {/* INPUT AREA */}
        {/* ================================================= */}

        <div className="input-section">
          <div className="input-wrapper">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                activeMode === "generation"
                  ? "Describe the image you want to create..."
                  : activeMode === "understanding"
                    ? "Ask something about the image..."
                    : "Type your message..."
              }
              rows={1}
            />

            {/* IMAGE BUTTON */}

            {activeMode === "understanding" && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={handleImageSelect}
                />

                <button
                  className="input-action"
                  onClick={() => fileInputRef.current?.click()}
                  title="Upload image"
                >
                  <ImageIcon size={20} />
                </button>
              </>
            )}

            {/* SEND */}

            <button
              className="send-btn"
              onClick={sendMessage}
              disabled={
                isGenerating ||
                (activeMode === "understanding" && !selectedImage)
              }
            >
              <Send size={20} />
            </button>
          </div>

          <p className="disclaimer">
            Bodhi AI can make mistakes. Consider checking important information.
          </p>
        </div>
      </main>
    </div>
  );
}

export default ChatWindow;
