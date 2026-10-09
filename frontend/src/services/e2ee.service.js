const DB_NAME= "bodhi-e2ee";
const DB_VERSION = 1;
const STORE_NAME = "chat-keys";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function openKeyDatabase(){
  return new Promise((resolve,reject)=>{
    const request = indexedDB.open(DB_NAME,DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if(!db.objectStoreNames.contains(STORE_NAME)){
        db.createObjectStore(STORE_NAME,{keyPath:"id"});
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function getKeyId(userId,chatId){
  if(!userId || !chatId){
    throw new Error("User ID and chat ID are required for encryption.")
  }
  return `${String(userId)}:${String(chatId)}`

}

async function readKey(id){
  const db = await openKeyDatabase();

  return new Promise((resolve,reject)=>{
    const transaction = db.transaction(STORE_NAME,"readOnly")

    const request = transaction.objectStore(STORE_NAME).get(id)

    request.onsuccess= () => {
      db.close()
      resolve(request.result?.key||null)
    }
    request.onerror = () => {
      db.close();
      reject(request.error)
    }
  })
}

async function saveKey(id,key){
  const db = await openKeyDatabase()

  return new Promise((resolve,reject)=>{
    const transaction = db.transaction(STORE_NAME,"readwrite")
    transaction.objectStore(STORE_NAME).put({id,key})

    transaction.oncomplete = () => {
      db.close()
      resolve()
    }

    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }

    transaction.onabort = () => {
      db.close()
      reject(transaction.error || new Error("Could not save encryption key"))
    }
  })
}

async function getChatKey(userId,chatId){
  const id = getKeyId(userId,chatId)
  let key = await readKey(id)

  if(key){
    return key
  }

  key = await crypto.subtle.generateKey({
    name:"AES-GCM",
    length:256,
  },false,
["encrypt","decrypt"])

await saveKey(id,key)
return key;


}

function bytesToBase64(bytes){
  let binary = "";
  const chunkSize = 0x8000;

  for(let i=0;i<bytes.length;i+=chunkSize){
    binary += String.fromCharCode(...bytes.subarray(i,i+chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(base64){
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for(let i=0;i<binary.length;i+=1){
    bytes[i] = binary.charCodeAt(i)

  }
  return bytes
}

async function encryptBytes(bytes,userId,chatId,kind,mimeType){
  const key = await getChatKey(userId,chatId)
  const iv = crypto.getRandomValues(new Uint8Array(12))

  const ciphertext = await crypto.subtle.encrypt({
    name:"AES-GCM",
    iv,
  },key,
bytes)
  return {
    version:1,
    algorithm:"AES-256-GCM",
    keyId:getKeyId(userId,chatId),
    kind,
    mimeType:mimeType||null,
    iv:bytesToBase64(iv),
    ciphertext:bytesToBase64(new Uint8Array(ciphertetxt))
  }
}

function parseEnvelope(value){
  if(typeof value === "string"){
    try{
      return JSON.parse(value)
    }catch{
      throw new Error("This message is not a valid encrypted envelope")
    }
  }
  return value;
}

export async function encryptedText(text,userId,chatId){
  if(typeof text!=="string" || !text.length){
    throw new Error("Message cannot be empty")
  }

  return encryptBytes(encoder.encode(text),userId,chatId,"text","text/plain;charset=utf-8")
}
//exporting encryot file
export async function encryptFile(file,userId,chatId){
  if(!(file instanceof Blob)){
    throw new Error("A valid attachment is required")
  }

  return encryptBytes(new Uint8Array(await file.arrayBuffer()),
userId,chatId,"image",file.type||"application/octet-stream")
}

export async function decryptEnvelope(value,userId,chatId){
  const envelope = parseEnvelope(value);

  if(!envelope||envelope.version!==1||envelope.algorithm!=="AES-256-GCM"||!envelope.iv||!envelope.ciphertext||envelope.keyId!==getKeyId(userId,chatId)){
    throw new Error("Invalid encrypted message or no matching local chat key")
  }
  const key = await readKey(envelope.keyId)

  if(!key){
    throw new Error("Encryption key cannot found")
  }

  const plaintext = await crypto.subtle.decrypt({
    name:"AES-GCM",
    iv:base64ToBytes(envelope.iv),
  },key,
base64ToBytes(envelope.ciphertext));

if(envelope.kind==="image"){
  return {
    kind:"image",
    mimeType:envelope.mimeType||"application/octet-stream",
    blob:new Blob([plaintext],{
      type:envelope.mimeType||"application/octet-stream"
    })
  }
}

return {
  kind:"text",
  text:decoder.decode(plaintext)
}

}
