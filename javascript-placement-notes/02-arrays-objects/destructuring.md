# Destructuring in JavaScript (Arrays & Objects)

Destructuring is an ES6 feature that allows you to "unpack" values from arrays or properties from objects into individual variables with a very clean, compact syntax.

In React and modern Node.js, destructuring is used on almost every single line.

---

## 1. Array Destructuring

In array destructuring, **position (order) matters**.

```javascript
const rgb = [255, 128, 0];

// Unpacking in order:
const [red, green, blue] = rgb;

console.log(red);   // 255
console.log(green); // 128
console.log(blue);  // 0
```

### Skipping Items
If you only need certain positions, leave the space blank with a comma:

```javascript
const scores = [90, 85, 70, 95];

// Grab the 1st and 3rd score:
const [first, , third] = scores;

console.log(first, third);
```

**Output:**
```
90 70
```

### Magic Trick: Swapping Two Variables Without a Temp Variable!
Interviewers love asking how to swap two variables without a third variable.

```javascript
let a = 10;
let b = 20;

// One-line swap using array destructuring:
[a, b] = [b, a];

console.log("a:", a, "b:", b);
```

**Output:**
```
a: 20 b: 10
```

---

## 2. Object Destructuring

In object destructuring, **the variable name must match the key name** in the object. Order does not matter!

```javascript
const user = {
    name: "Goutam",
    age: 22,
    role: "Full Stack SDE"
};

const { name, role } = user;

console.log(name, "->", role);
```

**Output:**
```
Goutam -> Full Stack SDE
```

---

## 3. Renaming Variables & Default Values

### Renaming a property (using `:`)
If you want to store the property in a variable with a different name:

```javascript
const student = {
    fullName: "Aman Sharma",
    branch: "CSE"
};

const { fullName: studentName } = student;
console.log(studentName);
```

**Output:**
```
Aman Sharma
```

### Providing Default Values (using `=`)
If a property might not exist, you can provide a fallback value:

```javascript
const settings = {
    theme: "dark"
};

const { theme, fontSize = "16px" } = settings;

console.log(theme);
console.log(fontSize); // Used fallback because fontSize was undefined
```

**Output:**
```
dark
16px
```

---

## 4. Nested Destructuring

When working with real-world APIs, data is often nested several layers deep:

```javascript
const response = {
    data: {
        profile: {
            username: "goutam_01",
            contact: {
                email: "goutam@example.com"
            }
        }
    }
};

// Deep extraction in one line:
const {
    data: {
        profile: {
            username,
            contact: { email }
        }
    }
} = response;

console.log(username);
console.log(email);
```

**Output:**
```
goutam_01
goutam@example.com
```

---

## 5. Destructuring in Function Parameters (React Pattern!)

Instead of receiving `props` and writing `props.user` everywhere, destructure right inside the function parentheses:

```javascript
// Clean React Component style:
function displayBadge({ name, role = "Member" }) {
    console.log(`[${role.toUpperCase()}] ${name}`);
}

const userObj = { name: "Sneha", role: "Admin" };
displayBadge(userObj);
```

**Output:**
```
[ADMIN] Sneha
```

---

## 6. Optional Chaining (`?.`) with Nested Objects

Before ES2020, if you tried to access a property on an object that was `undefined`, your whole application crashed with a `TypeError: Cannot read properties of undefined`.

Optional chaining (`?.`) stops the crash and safely evaluates to `undefined` if the property before it does not exist:

```javascript
const user = {
    name: "Rahul"
    // address is missing!
};

// ❌ Crashes without optional chaining:
// console.log(user.address.city); // TypeError!

// ✅ Safe with optional chaining:
console.log(user.address?.city);
```

**Output:**
```
undefined
```

---

## 💡 Think of it like this

- Destructuring is like unpacking an Amazon package. Instead of rummaging through the cardboard box every time you need a cable, you take the headphones and charger out and place them directly on your desk for instant access.
- Optional chaining (`?.`) is like tapping on a glass door gently before pushing. If there's a wall behind it, you stop safely instead of banging your head into concrete!

---

## ⚠️ Common Mistakes

### Confusing Renaming `:` with Default Values `=`

```javascript
const config = { port: 8080 };

// ❌ MISTAKE: Thinking port: 3000 sets a default value
// const { port: 3000 } = config; // SyntaxError!

// ✅ CORRECT:
// Renaming: { oldKey: newVariableName }
// Default value: { key = defaultValue }
const { port = 3000 } = config;
const { port: serverPort } = config;
```

---

## 🎯 Interview Points

1. **What happens if you destructure a property that doesn't exist?**
   - It gets assigned `undefined` (unless a default value was provided).

2. **How does optional chaining work with method calls and array indexing?**
   - Methods: `user.login?.()` (calls only if `login` is a function).
   - Arrays: `users?.[0]` (accesses index 0 only if `users` is not null/undefined).
