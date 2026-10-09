/*
const { Server } = require("socket.io");
const cookie = require("cookie");
const jwt = require("jsonwebtoken");
const userModel = require("../models/user.model");
const aiService = require("../service/ai.service");
const messageModel = require("../models/message.model");
const { createMemory, queryMemory } = require("../service/vector.service");
const { uploadImage } = require("../service/storage.service");

function initSocketServer(httpServer) {
  const io = new Server(httpServer, {});

  io.use(async (socket, next) => {
    const cookies = cookie.parseCookie(socket.handshake.headers?.cookie || "");
    console.log(cookies);

    if (!cookies.token) {
      next(new Error("Aythentication Error: No token provided"));
    }

    try {
      const decoded = jwt.verify(cookies.token, process.env.JWT_SECRET_KEY);

      const user = await userModel.findOne({ _id: decoded.id });

      socket.user = user;

      next();
    } catch (err) {
      next(new Error("Aythentication Error: No token provided"));
    }
  });

  io.on("connection", (socket) => {
    console.log("User connected: ", socket.user);
    console.log("New Socket Connection", socket.id);

    socket.on("ai-message", async (messagePayload) => {
      console.log(messagePayload);

      /* console.log(
        "chatHistory",
        chatHistory.map((item) => {
          return {
            role: item.role,
            parts: [{ text: item.content }],
          };
        }),
      ); //

      const message = await messageModel.create({
        chat: messagePayload.chat,
        user: socket.user._id,
        content: messagePayload.content,
        role: "user",
      });

      const vectors = await aiService.generateVector(messagePayload.content);
      console.log("vectors generated: ", vectors);

      /*
      const [message, vectors] = await Promise.all([
        messageModel.create({
          chat: messagePayload.chat,
          user: socket.user._id,
          content: messagePayload.content,
          role: "user",
        }),
        aiService.generateVector(messagePayload.content),
        createMemory({
          vectors,

          metadata: {
            chat: messagePayload.chat.toString(),
            user: socket.user._id.toString(),
            text: messagePayload.content,
          },
          messageId: message._id,
        }),
      ]); //

      const memory = await queryMemory({
        queryVector: vectors,
        limit: 3,
        metadata: {
          user: socket.user._id.toString(),
          chat: messagePayload.chat.toString(),
        },
      });

      await createMemory({
        vectors,

        metadata: {
          chat: messagePayload.chat.toString(),
          user: socket.user._id.toString(),
          text: messagePayload.content,
        },
        messageId: message._id,
      });

      console.log(memory);

      const chatHistory = (
        await messageModel
          .find({
            chat: messagePayload.chat,
          })
          .sort({ createdAt: -1 })
          .limit(20)
          .lean()
      ).reverse();

      const stm = chatHistory.map((item) => {
        return {
          role: item.role,
          parts: [{ text: item.content }],
        };
      });

      const ltm = [
        {
          role: "user",
          parts: [
            {
              text: `these are some previous messages from the chat, use them to generate a response
              
              ${memory.map((item) => item.metadata.text).join("/n")}

              `,
            },
          ],
        },
      ];

      console.log(ltm[0]);
      console.log(stm);

      const response = await aiService.generateResponse([...ltm, ...stm]);

      const responseMessage = await messageModel.create({
        chat: messagePayload.chat,
        user: socket.user._id,
        content: response,
        role: "model",
      });

      const responseVectors = await aiService.generateVector(response);
      console.log("vectors generated: ", responseVectors);

      await createMemory({
        vectors: responseVectors,

        metadata: {
          chat: messagePayload.chat.toString(),
          user: socket.user._id.toString(),
          text: response,
        },
        messageId: responseMessage._id,
      });

      socket.emit("ai-response", {
        content: response,
        chat: messagePayload.chat,
      });
    });
  });
}

module.exports = initSocketServer;
*/

const { Server } = require("socket.io");
const cookie = require("cookie");
const jwt = require("jsonwebtoken");

const userModel = require("../models/user.model");
const messageModel = require("../models/message.model");

const aiService = require("../service/ai.service");

const { createMemory, queryMemory } = require("../service/vector.service");

const { uploadImage } = require("../service/storage.service");

// =========================================================
// HELPER 1
// SHORT TERM MEMORY
// =========================================================
//
// Current chat ke latest 20 messages.
// STM = current conversation context.
//
// =========================================================

async function getShortTermMemory(chatId) {
  const chatHistory = (
    await messageModel
      .find({
        chat: chatId,
      })
      .sort({
        createdAt: -1,
      })
      .limit(20)
      .lean()
  ).reverse(); //array

  return chatHistory
    .map((item) => {
      // ===================================================
      // TEXT MESSAGE
      // ===================================================

      if (item.type === "text") {
        return {
          role: item.role,

          parts: [
            {
              text: item.content,
            },
          ],
        };
      }

      // ===================================================
      // IMAGE MESSAGE
      // ===================================================

      if (item.type === "image") {
        return {
          role: item.role,

          parts: [
            {
              text: `[Image message: ${item.content}]`,
            },
          ],
        };
      }

      return null;
    })
    .filter(Boolean);
}

// =========================================================
// HELPER 2
// LONG TERM MEMORY
// =========================================================
//
// LTM USER BASED hai.
//
// Chat filter intentionally nahi hai.
//
// User ke different chats se relevant memories aa sakti hain.
//
// =========================================================

async function getLongTermMemory({
  queryVector,
  namespace,
  userId,
  limit = 5,
}) {
  const memories = await queryMemory({
    queryVector,
    limit,

    metadata: {
      user: userId.toString(),
    },

    namespace,
  });

  if (!memories.length) {
    return [];
  }

  // =======================================================
  // Pinecone → MongoDB message IDs
  // =======================================================

  const messageIds = memories
    .map((item) => item.metadata?.messageId)
    .filter(Boolean);

  if (!messageIds.length) {
    return [];
  }

  // =======================================================
  // MongoDB actual messages
  // =======================================================

  const messages = await messageModel
    .find({
      _id: {
        $in: messageIds,
      },
    })
    .lean();

  // =======================================================
  // Similarity order preserve
  // =======================================================

  const messageMap = new Map(
    messages.map((message) => [message._id.toString(), message]),
  );

  return messageIds.map((id) => messageMap.get(id)).filter(Boolean);
}

// =========================================================
// HELPER 3
// FORMAT LTM
// =========================================================

function formatLongTermMemory(messages) {
  if (!messages.length) {
    return "";
  }

  return messages
    .map((message) => {
      const role = message.role === "model" ? "AI" : "User";

      if (message.type === "image") {
        return `${role}: [Previous image: ${message.content}]`;
      }

      return `${role}: ${message.content}`;
    })
    .join("\n");
}

// user: [Previous image: https://hjfdhbfdnbnmbfm.imagekit.com]

// =========================================================
// HELPER 4
// GET IMAGE URLS
// =========================================================

function getImageUrlsFromMemory(messages) {
  return messages
    .filter((message) => message.type === "image")
    .map((message) => message.content)
    .filter(Boolean);
}

//[https://hjfdhbfdnbnmbfm.imagekit.com,https://hjfdhbfdnbnmbfm.imagekit.com,https://hjfdhbfdnbnmbfm.imagekit.com]

// =========================================================
// HELPER 5
// FETCH IMAGE FROM IMAGEKIT
// =========================================================

async function fetchImageBuffer(imageUrl) {
  const response = await fetch(imageUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();

  return Buffer.from(arrayBuffer);
}

// =========================================================
// SOCKET SERVER
// =========================================================

function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    maxHttpBufferSize: 10 * 1024 * 1024,
    cors: {
      origin: ["http://localhost:5173", "http://localhost:3000"],
      credentials: true,
    },
  });

  // =======================================================
  // SOCKET AUTHENTICATION
  // =======================================================

  io.use(async (socket, next) => {
    try {
      const cookies = cookie.parseCookie(
        socket.handshake.headers?.cookie || "",
      );

      if (!cookies.token) {
        return next(new Error("Authentication Error: No token provided"));
      }

      const decoded = jwt.verify(cookies.token, process.env.JWT_SECRET_KEY);

      const user = await userModel.findOne({
        _id: decoded.id,
      });

      if (!user) {
        return next(new Error("Authentication Error: User not found"));
      }

      socket.user = user;

      next();
    } catch (error) {
      console.error("Socket Authentication Error:", error);

      next(new Error("Authentication Error: Invalid token"));
    }
  });

  // =======================================================
  // CONNECTION
  // =======================================================

  io.on("connection", (socket) => {
    console.log("User connected:", socket.user._id.toString());

    console.log("New Socket Connection:", socket.id);

    // =====================================================
    // AI MESSAGE
    // =====================================================

    socket.on("e2ee-message", async (messagePayload) => {
      try {
        console.log("Message Payload:", messagePayload);

        // =================================================
        // COMMON DATA
        // =================================================

        const userId = socket.user._id;

        const chatId = messagePayload.chat;

        const envelope = messagePayload.envelope;

        const messageType = messagePayload.type || "text";

        const messageMode = messagePayload.mode || "chat";

        if(!envelope || typeof envelope !== "object" || Array.isArray(envelope)){
          return socket.emit("e2ee-message-error",{
            message:"A valid chat ID is required"
          })
        }

        if(!envelope || typeof envelope !== "object" || Array.isArray(envelope)){
          return socket.emit("e2ee-message-error",{
            message:"An encrypted message envelope is required."
          })
        }

        const chatDocument = await chatModel.findById(chatId).lean()

        const chatOwner = chatDocument?.user||chatDocument.userQ||chatDocument.owner;;

        if(!envelope || typeof envelope!=="object" || Array.isArray(envelope)){
          return socket.emit("e2ee-message-error",{
            message: "An encrypted message envelope required"
          })
        }

        const validEnvelope = envelope.version === 1 && envelope.algorithm === "AES-GCM-256" && typeof envelope.keyId === "string" && envelope.keyId.length>0 && envelope.keyId.length<=200 && ["text","image"].includes(envelope.kind)&&typeof envelope.iv==="string" && envelope.iv.length>0 && envelope.cipherText.length > 0 && (envelope.mimeType==null || (typeof envelope.mimeType==="string" && envelope.mimeType.length <=150))

        if(!validEnvelope){
          return socket.emit("e2ee-message-error",{
            message:"Invalid or oversized encrypted message envelope"
          })
        }

        const encryptedMessage = await messageModel.create({
          chat:chatId,
          user:userId,
          content:JSON.stringify(envelope),
          type:envelope.kind==="image"?"image":"text",
          role:"user",
          mode:"e2ee"
        })

        try{

        socket.emit("e2ee-message-saved",{
          chat:chatId,
          message:{
            _id:encryptedMessage._id.toString(),
            chat:chatId,
            type:encryptedMessage.type,
            role:"user",
            mode:"e2ee",
            content:JSON.stringify(envelope),
            createdAt:encryptedMessage.createdAt
          }
        })}catch(error){
          console.error("E2EE message save failed",error?.message||error)

          socket.emit("e2ee-message-error",{
            message:"Unable to save the encrypted message"
          })
        }

        socket.emit("ai-message",async (messagePayload)=>{
          const userId = socket.user._id;

        const chatId = messagePayload.chat;

        

        const messageType = messagePayload.type || "text";

        const messageMode = messagePayload.mode || "chat";
        

        // =================================================
        // 1. NORMAL TEXT CHAT
        // =================================================

        if (messageType === "text" && messageMode === "chat") {
          const userContent = messagePayload.content;

          if (!userContent?.trim()) {
            return socket.emit("ai-error", {
              message: "Message content is required.",
            });
          }

          // =============================================
          // SAVE USER MESSAGE
          // =============================================

          const message = await messageModel.create({
            chat: chatId,

            user: userId,

            content: userContent,

            type: "text",

            mode: "chat",

            role: "user",
          });

          // =============================================
          // TEXT VECTOR
          // =============================================

          const queryVector = await aiService.generateVector(userContent);

          console.log("Text vector generated:", queryVector.length);

          // =============================================
          // LTM
          // =============================================

          const ltmMessages = await getLongTermMemory({
            queryVector,

            namespace: "text-memory",

            userId,

            limit: 5,
          });

          console.log("Text LTM:", ltmMessages.length);

          // =============================================
          // SAVE USER VECTOR
          // =============================================

          await createMemory({
            vectors: queryVector,

            metadata: {
              user: userId.toString(),

              chat: chatId.toString(),

              messageId: message._id.toString(),

              role: "user",

              type: "text",
            },

            messageId: message._id.toString(),

            namespace: "text-memory",
          });

          // =============================================
          // STM
          // =============================================

          const stm = await getShortTermMemory(chatId);

          // =============================================
          // FORMAT LTM
          // =============================================

          const ltmText = formatLongTermMemory(ltmMessages);

          // =============================================
          // GEMINI CONTEXT
          // =============================================

          const ltm = [
            {
              role: "user",

              parts: [
                {
                  text: `
These are relevant memories from the user's previous conversations.

These memories may belong to different chats.

Use them only when relevant.

<long_term_memory>
${ltmText}
</long_term_memory>
                    `,
                },
              ],
            },
          ];

          // =============================================
          // GENERATE RESPONSE
          // =============================================

          const response = await aiService.generateResponse([...ltm, ...stm]);

          // =============================================
          // SAVE AI RESPONSE
          // =============================================

          const responseMessage = await messageModel.create({
            chat: chatId,

            user: userId,

            content: response,

            type: "text",

            mode: "chat",

            role: "model",
          });

          // =============================================
          // AI RESPONSE VECTOR
          // =============================================

          const responseVector = await aiService.generateVector(response);

          // =============================================
          // SAVE AI MEMORY
          // =============================================

          await createMemory({
            vectors: responseVector,

            metadata: {
              user: userId.toString(),

              chat: chatId.toString(),

              messageId: responseMessage._id.toString(),

              role: "model",

              type: "text",
            },

            messageId: responseMessage._id.toString(),

            namespace: "text-memory",
          });

          // =============================================
          // SEND RESPONSE
          // =============================================

          socket.emit("ai-response", {
            content: response,

            type: "text",

            chat: chatId,
          });

          return;
        }

        // =================================================
        // 2. IMAGE UNDERSTANDING
        // =================================================

        if (messageType === "image" && messageMode === "image-understanding") {
          // =============================================
          // BASE64 → BUFFER
          // =============================================

          if (!messagePayload.content) {
            return socket.emit("ai-error", {
              message: "Image data is required.",
            });
          }

          const imageBuffer = Buffer.from(messagePayload.content, "base64");

          const mimeType = messagePayload.mimeType || "image/jpeg";

          // =============================================
          // IMAGEKIT UPLOAD
          // =============================================

          console.log("1. ImageKit upload starting");

          const imageUrl = await uploadImage({
            buffer: imageBuffer,

            fileName: `image-${Date.now()}`,

            folder: "/image-understanding",
          });

          console.log("2. ImageKit upload completed");

          // =============================================
          // SAVE USER IMAGE
          // =============================================

          const imageMessage = await messageModel.create({
            chat: chatId,

            user: userId,

            content: imageUrl,

            type: "image",

            mode: "image-understanding",

            role: "user",
          });

          // =============================================
          // IMAGE VECTOR
          // =============================================

          console.log("3. Image embedding starting");

          const imageVector = await aiService.generateImageVector(
            imageBuffer,
            mimeType,
          );

          console.log("Image vector generated:", imageVector.length);

          // =============================================
          // IMAGE LTM
          // =============================================

          const imageMemory = await getLongTermMemory({
            queryVector: imageVector,

            namespace: "image-understanding",

            userId,

            limit: 5,
          });

          console.log("Image LTM:", imageMemory.length);

          // =============================================
          // SAVE CURRENT IMAGE VECTOR
          // =============================================

          await createMemory({
            vectors: imageVector,

            metadata: {
              user: userId.toString(),

              chat: chatId.toString(),

              messageId: imageMessage._id.toString(),

              role: "user",

              type: "image",

              imageUrl,
            },

            messageId: imageMessage._id.toString(),

            namespace: "image-understanding",
          });

          // =============================================
          // USER PROMPT
          // =============================================

          const prompt =
            messagePayload.prompt ||
            "Analyze this image and describe what you see.";

          // =============================================
          // SAVE PROMPT
          // =============================================

          let promptMessage = null;

          if (messagePayload.prompt) {
            promptMessage = await messageModel.create({
              chat: chatId,

              user: userId,

              content: messagePayload.prompt,

              type: "text",

              mode: "image-understanding",

              role: "user",
            });

            /*
             * Prompt ko image-understanding
             * namespace mein store nahi kar rahe.
             *
             * Reason:
             *
             * imageVector aur generateVector()
             * ke vectors different embedding models
             * se aa rahe hain.
             *
             * Isliye unko same similarity search mein
             * mix nahi karna chahiye.
             */
          }

          // =============================================
          // STM
          // =============================================

          const stm = await getShortTermMemory(chatId);

          // =============================================
          // IMAGE LTM TEXT
          // =============================================

          const ltmText = formatLongTermMemory(imageMemory);

          // =============================================
          // PREVIOUS IMAGES
          // =============================================

          const oldImageUrls = getImageUrlsFromMemory(imageMemory);

          console.log("Relevant old image URLs:", oldImageUrls);

          // =============================================
          // FETCH PREVIOUS IMAGES
          // =============================================

          const previousImages = [];

          for (const oldImageUrl of oldImageUrls) {
            try {
              const oldImageBuffer = await fetchImageBuffer(oldImageUrl);

              previousImages.push({
                buffer: oldImageBuffer,

                mimeType: "image/jpeg",

                url: oldImageUrl,
              });
            } catch (error) {
              console.error("Failed to fetch previous image:", error.message);
            }
          }

          // =============================================
          // GEMINI IMAGE UNDERSTANDING
          // =============================================

          console.log("4. Previous image retrieval completed");

          console.log("5. Gemini image understanding starting");

          const response = await aiService.generateResponseIMG(
            imageBuffer,

            mimeType,

            prompt,

            previousImages,

            ltmText,

            stm,
          );

          console.log("6. Gemini image understanding completed");

          // =============================================
          // SAVE AI RESPONSE
          // =============================================

          const responseMessage = await messageModel.create({
            chat: chatId,

            user: userId,

            content: response,

            type: "text",

            mode: "image-understanding",

            role: "model",
          });

          /*
           * AI response ko image-understanding
           * namespace mein vector ke roop mein
           * store nahi kar rahe.
           *
           * Reason:
           * image-understanding query image embedding
           * se ho rahi hai.
           *
           * Text embedding aur image embedding ko
           * same similarity space mein mix karna
           * avoid karna better hai.
           */

          // =============================================
          // SEND RESPONSE
          // =============================================

          socket.emit("ai-response", {
            content: response,

            type: "text",

            imageUrl,

            chat: chatId,
          });

          return;
        }

        // =================================================
        // 3. IMAGE GENERATION
        // =================================================

        if (messageMode === "image-generation") {
          const prompt = messagePayload.content;

          if (!prompt?.trim()) {
            return socket.emit("ai-error", {
              message: "Image generation prompt is required.",
            });
          }

          // =============================================
          // SAVE USER PROMPT
          // =============================================

          const promptMessage = await messageModel.create({
            chat: chatId,

            user: userId,

            content: prompt,

            type: "text",

            mode: "image-generation",

            role: "user",
          });

          // =============================================
          // PROMPT VECTOR
          // =============================================

          const promptVector = await aiService.generateVector(prompt);

          console.log("Image generation prompt vector:", promptVector.length);

          // =============================================
          // IMAGE GENERATION LTM
          // =============================================
          //
          // Query text prompt against text prompt
          // memories.
          //
          // =============================================

          const ltmMessages = await getLongTermMemory({
            queryVector: promptVector,

            namespace: "image-generation",

            userId,

            limit: 5,
          });

          console.log("Image generation LTM:", ltmMessages.length);

          // =============================================
          // SAVE USER PROMPT VECTOR
          // =============================================

          await createMemory({
            vectors: promptVector,

            metadata: {
              user: userId.toString(),

              chat: chatId.toString(),

              messageId: promptMessage._id.toString(),

              role: "user",

              type: "text",
            },

            messageId: promptMessage._id.toString(),

            namespace: "image-generation",
          });

          // =============================================
          // STM
          // =============================================

          const stm = await getShortTermMemory(chatId);

          // =============================================
          // FORMAT LTM
          // =============================================

          const ltmText = formatLongTermMemory(ltmMessages);

          // =============================================
          // PREVIOUS GENERATED IMAGE URLS
          // =============================================

          const previousImageUrls = getImageUrlsFromMemory(ltmMessages);

          console.log("Previous generated images:", previousImageUrls);

          // =============================================
          // CURRENT CONVERSATION
          // =============================================

          const stmText = stm
            .map((item) => item.parts?.[0]?.text || "")
            .join("\n");

          // =============================================
          // ENHANCED PROMPT
          // =============================================

          const enhancedPrompt = `
You are an AI image generation system.

Generate an image based on the user's current request.

<current_request>
${prompt}
</current_request>

Relevant memories from the user's previous
image generation requests:

<image_generation_memory>
${ltmText}
</image_generation_memory>

Previous generated image URLs:

<previous_generated_images>
${previousImageUrls.join("\n")}
</previous_generated_images>

Recent conversation:

<recent_conversation>
${stmText}
</recent_conversation>

Instructions:

- Follow the current request as the primary instruction.
- Use previous memories only when they are relevant.
- If the user refers to a previous image or generation,
  use the relevant previous context.
- Do not blindly copy unrelated previous requests.
- Generate the best possible image prompt interpretation.
`;

          // =============================================
          // GENERATE IMAGE
          // =============================================

          console.log("Generating image...");

          const imageBuffer = await aiService.generateIMG(enhancedPrompt);

          console.log("Image generation completed.");

          // =============================================
          // IMAGEKIT UPLOAD
          // =============================================

          console.log("Uploading generated image...");

          const imageUrl = await uploadImage({
            buffer: imageBuffer,

            fileName: `generated-${Date.now()}.png`,

            folder: "/ai-generated",
          });

          console.log("Generated image uploaded:", imageUrl);

          // =============================================
          // SAVE GENERATED IMAGE
          // =============================================

          const imageMessage = await messageModel.create({
            chat: chatId,

            user: userId,

            content: imageUrl,

            type: "image",

            mode: "image-generation",

            role: "model",
          });

          // =============================================
          // IMAGE VECTOR
          // =============================================

          const generatedImageVector = await aiService.generateImageVector(
            imageBuffer,

            "image/png",
          );

          console.log("Generated image vector:", generatedImageVector.length);

          /*
           * IMPORTANT:
           *
           * Image vector ko image-generation
           * namespace mein store kar rahe hain.
           *
           * Lekin future TEXT prompt query ke
           * similarity results mein is vector
           * ko rely nahi karna chahiye because
           * prompt vector = gemini-embedding-001
           * image vector = gemini-embedding-2
           *
           * Isliye actual prompt retrieval
           * prompt vectors se hoga.
           */

          await createMemory({
            vectors: generatedImageVector,

            metadata: {
              user: userId.toString(),

              chat: chatId.toString(),

              messageId: imageMessage._id.toString(),

              role: "model",

              type: "image",

              imageUrl,

              sourcePromptId: promptMessage._id.toString(),
            },

            messageId: imageMessage._id.toString(),

            namespace: "image-generation",
          });

          // =============================================
          // ALSO SAVE IMAGE URL AGAINST PROMPT MEMORY
          // =============================================
          //
          // Ye important hai.
          //
          // Future text prompt similarity search
          // prompt vector ko retrieve karegi.
          //
          // Us prompt ke memory record mein
          // generated image URL bhi hona chahiye.
          //
          // Existing vector ko metadata update karna
          // vector.service.js mein currently available
          // nahi hai.
          //
          // Isliye separate prompt-image memory record
          // create kar rahe hain using SAME prompt vector.
          //
          // =============================================

          const promptImageMemoryId = `${promptMessage._id.toString()}-image`;

          await createMemory({
            vectors: promptVector,

            metadata: {
              user: userId.toString(),

              chat: chatId.toString(),

              messageId: imageMessage._id.toString(),

              promptMessageId: promptMessage._id.toString(),

              role: "model",

              type: "image",

              imageUrl,

              source: "prompt-image-memory",
            },

            messageId: promptImageMemoryId,

            namespace: "image-generation",
          });

          }

          // =============================================
          // SEND GENERATED IMAGE
          // =============================================

          socket.emit("ai-response", {
            content: imageUrl,

            type: "image",

            chat: chatId,
          });

          return;
        })

        // =================================================
        // UNKNOWN REQUEST
        // =================================================

        socket.emit("ai-error", {
          message: "Unsupported message type or mode.",
        });
      } catch (error) {
        console.error("AI Message Error:", error);

        socket.emit("ai-error", {
          message: "Something went wrong while processing your request.",
        });
      }
    });
  });
}

module.exports = initSocketServer;
