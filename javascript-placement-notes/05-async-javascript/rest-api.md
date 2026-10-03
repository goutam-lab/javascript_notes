# REST APIs & HTTP Requests in JavaScript

In frontend development, React, and backend Node.js interviews, knowing how your code communicates with backend servers over a **REST API** is mandatory.

Let's break down what a REST API is, how HTTP works, and how to write clean `GET`, `POST`, `PUT`, and `DELETE` requests in modern JavaScript.

---

## 1. What is an API?

> **API (Application Programming Interface)** is a bridge that allows two software programs to talk to each other.

Think of it like a waiter in a restaurant:
- **You (The Client/Frontend)**: Look at the menu and place an order.
- **The Waiter (The API)**: Takes your order to the kitchen and brings back your food.
- **The Kitchen (The Database/Server)**: Prepares the food and sends it out.

---

## 2. What is a REST API?

**REST** stands for **Representational State Transfer**.

It is an architectural set of rules for designing web APIs using standard HTTP protocol conventions.

In a REST API:
- Data is treated as **Resources** (e.g., users, products, orders).
- Each resource has a unique **URL endpoint** (e.g., `https://api.store.com/products`).
- Actions are determined by **HTTP Methods** (verbs), NOT by URL names!

---

## 3. The 5 Core HTTP Methods (CRUD)

| Operation | HTTP Method | Endpoint Example | Description |
| :--- | :--- | :--- | :--- |
| **C**reate | **POST** | `/users` | Create a new user resource |
| **R**ead | **GET** | `/users` or `/users/101` | Retrieve a list of users or a single user |
| **U**pdate (Full) | **PUT** | `/users/101` | Replace the **entire** user with new data |
| **U**pdate (Partial) | **PATCH** | `/users/101` | Update only **specific fields** (e.g. just email) |
| **D**elete | **DELETE** | `/users/101` | Remove the user resource |

> **Interview Golden Rule:** Good REST APIs use nouns in URLs (`/products`), never verbs (`/getProducts` or `/deleteProduct` are bad REST design!). The HTTP method itself indicates the action.

---

## 4. Path Parameters vs Query Parameters

When building URLs to request data:

### 1. Path Parameters (Direct Resource Identification)
Identifies a specific resource by its ID:
```
https://api.store.com/products/42
```
Points directly to product with ID 42.

### 2. Query Parameters (Filtering, Sorting, Pagination)
Starts with a `?` followed by `key=value` pairs joined by `&`:
```
https://api.store.com/products?category=electronics&limit=10&page=2
```
Filters for electronics, with 10 items per page, on page 2.

---

## 5. Anatomy of an HTTP Request

Every HTTP request sent by `fetch()` consists of:
1. **URL**: Where to send the request.
2. **Method**: `GET`, `POST`, `PUT`, `DELETE`.
3. **Headers**: Metadata about the request (e.g., format of data, auth tokens).
4. **Body**: The actual payload data being sent (for `POST`, `PUT`, `PATCH`).

---

## 6. Real-World Code Examples Using `fetch()`

---

### 1. GET Request (Read Data)
`GET` requests do not have a body. They only retrieve data.

```javascript
async function fetchUsers() {
    try {
        const response = await fetch("https://jsonplaceholder.typicode.com/users");

        if (!response.ok) {
            throw new Error(`HTTP Error! Status: ${response.status}`);
        }

        const users = await response.json();
        console.log("Users fetched:", users.length);
        console.log("First user:", users[0].name);
    } catch (error) {
        console.error("Failed to fetch users:", error.message);
    }
}

fetchUsers();
```

---

### 2. POST Request (Create New Data)
When sending data to the server:
- Set `method: "POST"`.
- Add header: `"Content-Type": "application/json"`.
- Convert your JavaScript object into a JSON string using **`JSON.stringify()`** in `body`.

```javascript
async function createUser(newUserData) {
    try {
        const response = await fetch("https://jsonplaceholder.typicode.com/users", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                // If the API requires authentication:
                "Authorization": "Bearer my_secret_token_123"
            },
            body: JSON.stringify(newUserData)
        });

        if (!response.ok) {
            throw new Error(`Failed to create user. Status: ${response.status}`);
        }

        const createdUser = await response.json();
        console.log("Created successfully with ID:", createdUser.id);
        return createdUser;
    } catch (error) {
        console.error("Error creating user:", error.message);
    }
}

createUser({
    name: "Goutam",
    email: "goutam@example.com",
    role: "Full Stack SDE"
});
```

---

### 3. PUT Request (Replace Data)

```javascript
async function updateUser(userId, updatedData) {
    try {
        const response = await fetch(`https://jsonplaceholder.typicode.com/users/${userId}`, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(updatedData)
        });

        const data = await response.json();
        console.log("Updated record:", data);
    } catch (err) {
        console.error(err);
    }
}
```

---

### 4. DELETE Request (Remove Data)

```javascript
async function deleteUser(userId) {
    try {
        const response = await fetch(`https://jsonplaceholder.typicode.com/users/${userId}`, {
            method: "DELETE"
        });

        if (response.ok) {
            console.log(`User ${userId} deleted successfully!`);
        }
    } catch (err) {
        console.error("Delete failed:", err);
    }
}

deleteUser(1);
```

---

## 7. HTTP Status Codes Every Placement Candidate Must Know

Interviewers will name a status code and ask what it means:

```
2xx = Success
3xx = Redirection
4xx = Client Errors (Your fault!)
5xx = Server Errors (Backend's fault!)
```

### High-Frequency Codes:
- **`200 OK`**: Request succeeded (Standard for successful GET, PUT, PATCH).
- **`201 Created`**: New resource successfully created (Standard for POST).
- **`204 No Content`**: Succeeded, but no data returned in response (Common for DELETE).
- **`400 Bad Request`**: Malformed request (e.g. missing required fields in JSON body).
- **`401 Unauthorized`**: Authentication is missing or invalid token (You are not logged in).
- **`403 Forbidden`**: Authenticated, but user lacks permission (e.g. viewer trying to delete admin).
- **`404 Not Found`**: The requested endpoint or resource ID does not exist.
- **`500 Internal Server Error`**: The server crashed or encountered an unexpected backend bug.
- **`503 Service Unavailable`**: Server is overloaded or down for maintenance.

---

## 💡 Think of it like this

Sending a REST API request is like mailing a package via the post office:
- **URL**: The physical street address on the envelope.
- **HTTP Method**: The stamp label on the box ("Deliver This" for POST, "Inspect This" for GET, "Shred This" for DELETE).
- **Headers**: Custom stickers on the outside ("Fragile", "Handle with Care", "Requires Signature").
- **Body**: The actual gift inside the cardboard box (`JSON.stringify(data)`).
- **Status Code**: The delivery confirmation receipt you get back (200 = Delivered, 404 = Address doesn't exist).

---

## ⚠️ Common Mistakes

### Mistake 1: Forgetting `"Content-Type": "application/json"`
If you omit this header in a POST/PUT request, the server won't know the body is JSON! Many backends (Express, Spring, Django) will leave `req.body` empty or undefined.

### Mistake 2: Forgetting `JSON.stringify()` in `body`
The HTTP protocol only transmits text streams. You cannot pass a raw JavaScript object `{ name: "Goutam" }` into `body`. You **must** stringify it first: `body: JSON.stringify(userObj)`.

### Mistake 3: Forgetting that `fetch()` doesn't throw on 404/500
Always check `if (!response.ok)`!

---

## 🎯 Interview Points

1. **What is the difference between PUT and PATCH?**
   - **`PUT`** replaces the **entire resource**. If an object has 5 fields and you send a PUT with only 2 fields, the other 3 fields will be overwritten or removed.
   - **`PATCH`** applies a **partial update**. Only the fields you send are updated; all other fields remain unchanged.

2. **What is an Idempotent HTTP method?**
   - An HTTP method is **idempotent** if making the same request multiple times produces the exact same result on the server state.
   - `GET`, `PUT`, `DELETE` are **idempotent** (deleting resource #5 ten times leaves it deleted).
   - `POST` is **NOT idempotent** (calling POST ten times creates 10 separate duplicate records in the database!).
