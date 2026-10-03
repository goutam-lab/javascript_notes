function add(a, b) {
    return a + b;
}

function add(a, b) {
    return a + b;
}

const add = (a, b) => a + b;

// If there is one parameter brackets are optional

const add = a => a;

const greet = () => {
    console.log("Hello");
};

const greet = () => "Hello";

console.log(greet());

// Arrow Functions + Arrays

arr.map((x) => x * 2);

let arr = [1, 2, 3, 4];

let result = arr.map((x) => x * 2);

console.log(result);

// callback

function process(callback) {
    callback();
}

function hello() {
    console.log("Hello");
}

process(hello);

// var is not block scoped

if (true) {
    var a = 10;
}
console.log(a); // 10

// let and const are block scoped

if (true) {
    let b = 20;
    const c = 30;
}
console.log(b); // undefined
console.log(c); // undefined

// shadow variable

if (true) {
    let a = 10;
    if (true) {
        let a = 20;
        console.log(a); // 20
    }
    console.log(a); // 10
}

//Hoisting means JavaScript processes certain declarations before executing the code.
// Hoisting
console.log(a); // undefined
var a = 10;

console.log(b); // reference error
let b = 20;

// closure

function counter() {
    let count = 0;

    return function() {
        count++;
        return count;
    };
}

const increment = counter();

console.log(increment());
console.log(increment());
console.log(increment());

// 1 2 3

//A closure can create private state.

function createCounter() {
    let count = 0;

    return {
        increment: function() {
            count++;
        },

        getCount: function() {
            return count;
        }
    };
}

const counter = createCounter();

counter.increment();
counter.increment();

console.log(counter.getCount());

// 2

for (var i = 0; i < 3; i++) {
    setTimeout(() => {
        console.log(i);
    }, 1000);
}

// Many beginners say:

// 0
// 1
// 2

// But with var, the output is:

// 3
// 3
// 3

// Why?

// Because var is function-scoped, so all three callbacks refer to the same i.

//A closure is created when a function retains access to variables from its lexical outer scope even after the outer function has finished executing.



