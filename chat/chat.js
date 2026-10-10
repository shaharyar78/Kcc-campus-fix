'use strict';

const messageList = document.querySelector('#chat-messages');
const chatForm = document.querySelector('#chat-form');
const chatInput = document.querySelector('#chat-input');
const nameInput = document.querySelector('#student-name');
const sendButton = document.querySelector('#send-button');
const statusText = document.querySelector('#chat-status');
const charCount = document.querySelector('#char-count');
const seen = new Set();

nameInput.value = localStorage.getItem('campusfix-chat-name') || '';

function setStatus(message, kind = '') {
  statusText.textContent = message;
  statusText.className = `status ${kind}`;
}

function addMessage(item) {
  if (!item || seen.has(item.id)) return;

  seen.add(item.id);

  const shouldScroll =
    messageList.scrollHeight -
    messageList.scrollTop -
    messageList.clientHeight < 90;

  messageList.querySelector('.empty, .loading')?.remove();

  const article = document.createElement('article');
  article.className =
    `message${item.name === nameInput.value.trim() ? ' mine' : ''}`;

  const head = document.createElement('div');
  head.className = 'message-head';

  const author = document.createElement('span');
  author.className = 'message-name';
  author.textContent = item.name;

  const time = document.createElement('time');
  const date = new Date(item.createdAt);
  time.dateTime = item.createdAt;
  time.textContent = Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit'
      });

  const text = document.createElement('p');
  text.textContent = item.message;

  head.append(author, time);
  article.append(head, text);
  messageList.append(article);

  if (shouldScroll) {
    messageList.scrollTop = messageList.scrollHeight;
  }
}

async function loadMessages() {
  try {
    const response = await fetch('/api/chat/messages', {
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error('Could not load chat messages.');
    }

    const items = await response.json();

    if (!Array.isArray(items)) {
      throw new Error('Chat response was invalid.');
    }

    if (items.length === 0 && seen.size === 0) {
      messageList.innerHTML =
        '<p class="empty">No messages yet. Start the discussion.</p>';
    }

    items.forEach(addMessage);
  } catch (error) {
    if (seen.size === 0) {
      messageList.innerHTML =
        '<p class="empty">Chat server se connect nahi ho pa raha. Server chalu karke page refresh karein.</p>';
    }

    setStatus(error.message, 'error');
  }
}

chatInput.addEventListener('input', () => {
  charCount.textContent = `${chatInput.value.length} / 500`;
});

nameInput.addEventListener('change', () => {
  localStorage.setItem('campusfix-chat-name', nameInput.value.trim());
});

chatForm.addEventListener('submit', async event => {
  event.preventDefault();

  const name = nameInput.value.trim();
  const message = chatInput.value.trim();

  if (name.length < 2) {
    nameInput.focus();
    setStatus('Please enter a display name with at least 2 characters.', 'error');
    return;
  }

  if (!message) return;

  sendButton.disabled = true;
  setStatus('Sending…');

  try {
    const response = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, message })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Message could not be sent.');
    }

    localStorage.setItem('campusfix-chat-name', name);
    addMessage(result);

    chatInput.value = '';
    charCount.textContent = '0 / 500';
    setStatus('Message sent.', 'success');
    chatInput.focus();
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    sendButton.disabled = false;
  }
});

loadMessages();
window.setInterval(loadMessages, 4000);