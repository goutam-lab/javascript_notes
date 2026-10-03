# JavaScript for DSA: String Patterns & Immutability

Strings in JavaScript are **immutable primitives**.

That means once a string is created, individual characters inside it cannot be altered in-place:
```javascript
let str = "hello";
str[0] = "H"; // Silently fails!
console.log(str); // Still "hello"
```

To modify a string, you must build a new string or convert it into an array of characters with `.split("")`.

---

## 1. Pattern 1: Valid Palindrome (Two Pointers)

Check if a string reads the same forwards and backwards, considering only alphanumeric characters and ignoring cases.

```javascript
function isPalindrome(s) {
    // Sanitize: lowercase and strip non-alphanumeric characters:
    const cleanStr = s.toLowerCase().replace(/[^a-z0-9]/g, "");

    let left = 0;
    let right = cleanStr.length - 1;

    while (left < right) {
        if (cleanStr[left] !== cleanStr[right]) {
            return false;
        }
        left++;
        right--;
    }

    return true;
}

console.log(isPalindrome("A man, a plan, a canal: Panama")); // true
console.log(isPalindrome("race a car")); // false
```

- **Time Complexity:** $O(N)$
- **Space Complexity:** $O(N)$

---

## 2. Pattern 2: Valid Anagram (Frequency Map)

Given two strings `s` and `t`, return `true` if `t` is an anagram of `s` (same characters with same counts).

```javascript
function isAnagram(s, t) {
    if (s.length !== t.length) return false;

    // Use a fixed 26-element array for lowercase English letters
    const charCount = new Array(26).fill(0);

    for (let i = 0; i < s.length; i++) {
        // 'a'.charCodeAt(0) === 97
        charCount[s.charCodeAt(i) - 97]++;
        charCount[t.charCodeAt(i) - 97]--;
    }

    // If all counts returned to 0, they are anagrams!
    return charCount.every((count) => count === 0);
}

console.log(isAnagram("anagram", "nagaram")); // true
console.log(isAnagram("rat", "car"));         // false
```

- **Time Complexity:** $O(N)$
- **Space Complexity:** $O(1)$ (Fixed 26-slot array)

---

## 3. Pattern 3: Longest Substring Without Repeating Characters (Sliding Window)

Find the length of the longest substring without duplicate characters.

```javascript
function lengthOfLongestSubstring(s) {
    const seenChars = new Set();
    let left = 0;
    let maxLength = 0;

    for (let right = 0; right < s.length; right++) {
        // If we hit a duplicate character, shrink window from the left:
        while (seenChars.has(s[right])) {
            seenChars.delete(s[left]);
            left++;
        }

        seenChars.add(s[right]);
        maxLength = Math.max(maxLength, right - left + 1);
    }

    return maxLength;
}

console.log(lengthOfLongestSubstring("abcabcbb")); // 3 ("abc")
console.log(lengthOfLongestSubstring("bbbbb"));    // 1 ("b")
```

- **Time Complexity:** $O(N)$ (Each character is visited at most twice)
- **Space Complexity:** $O(K)$ where $K$ is the number of unique characters in the set.

---

## 🎯 Interview Points

1. **How do you get ASCII / Unicode value of a character in JavaScript?**
   - Use `str.charCodeAt(index)`. E.g., `"a".charCodeAt(0)` is `97`.
   - To convert code back to character, use `String.fromCharCode(97)`.
