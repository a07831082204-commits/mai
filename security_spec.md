# Security Specification - muntadher.asd

## Data Invariants
1. A chat document must always belong to a specific user (via `userId`).
2. A message must always be associated with a valid parent chat document.
3. Users can only read/write their own chats and messages.
4. Timestamps for creation and updates must be validated using server-side time.
5. Critical identity fields like `userId` are immutable after creation.

## The Dirty Dozen Payloads

### 1. Identity Spoofing (Chat Creation)
```json
{
  "userId": "SOMEONE_ELSES_UID",
  "title": "Stolen Chat",
  "lastMessage": "This shouldn't work",
  "createdAt": "SERVER_TIMESTAMP",
  "updatedAt": "SERVER_TIMESTAMP"
}
```
**Expected**: PERMISSION_DENIED (UID must match `request.auth.uid`).

### 2. Resource Injection (Chat Creation)
```json
{
  "userId": "MY_UID",
  "title": "A".repeat(2000), 
  "lastMessage": "Too long",
  "createdAt": "SERVER_TIMESTAMP",
  "updatedAt": "SERVER_TIMESTAMP"
}
```
**Expected**: PERMISSION_DENIED (Title exceeds size limit).

### 3. Orphaned Write (Message Creation)
Attempt to write a message to a chat ID that doesn't exist or belongs to someone else.
**Expected**: PERMISSION_DENIED.

### 4. Shadow Update (Chat Update)
```json
{
  "isVerified": true,
  "updatedAt": "SERVER_TIMESTAMP"
}
```
**Expected**: PERMISSION_DENIED (Field `isVerified` is not allowed).

### 5. Identity Escaping (Chat Update)
```json
{
  "userId": "NEW_UID",
  "updatedAt": "SERVER_TIMESTAMP"
}
```
**Expected**: PERMISSION_DENIED (userId is immutable).

### 6. Temporal Hijack (Chat Creation)
```json
{
  "userId": "MY_UID",
  "title": "Old Chat",
  "createdAt": 1000000, 
  "updatedAt": 1000000
}
```
**Expected**: PERMISSION_DENIED (Must use `request.time`).

### 7. Global Data Scraping (List Queries)
Attacker tries to list all chats without a `where("userId", "==", uid)` clause.
**Expected**: PERMISSION_DENIED (Rules must enforce the filter).

### 8. Message Poisoning (Message Creation)
```json
{
  "role": "model",
  "text": "A".repeat(1000000), 
  "timestamp": 12345
}
```
**Expected**: PERMISSION_DENIED (Text exceeds size limit).

### 9. Illegal Role Assignment (Message Creation)
User tries to post as "admin" if we had that role, or just bypassing role validation.
**Expected**: PERMISSION_DENIED (Role must be one of the enum values).

### 10. Message Hijack (Message Update)
User tries to edit an old message's text.
**Expected**: PERMISSION_DENIED (Messages are immutable in this app's current logic, or strictly controlled).

### 11. Cross-User Deletion
UID A tries to delete UID B's chat.
**Expected**: PERMISSION_DENIED.

### 12. Blind Resource Probing
Attacker tries to `get` a chat document ID they don't own to check if it exists.
**Expected**: PERMISSION_DENIED.
