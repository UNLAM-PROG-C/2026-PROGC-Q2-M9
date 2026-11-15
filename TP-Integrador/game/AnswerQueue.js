class AnswerQueue {
  constructor() {
    this.items = [];
  }

  enqueue(answerEvent) {
    this.items.push(answerEvent);
  }

  dequeue() {
    return this.items.shift() || null;
  }

  isEmpty() {
    return this.items.length === 0;
  }

  size() {
    return this.items.length;
  }
}

module.exports = AnswerQueue;
