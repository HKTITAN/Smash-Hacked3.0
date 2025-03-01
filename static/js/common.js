// Common utility functions
const showAlert = (message, type = 'info') => {
    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.textContent = message;
    
    document.querySelector('.main-content').insertBefore(
        alert,
        document.querySelector('.main-content').firstChild
    );
    
    setTimeout(() => alert.remove(), 5000);
};

// Handle WebSocket reconnection
const setupWebSocket = (socket) => {
    socket.on('disconnect', () => {
        showAlert('Connection lost. Attempting to reconnect...', 'error');
    });

    socket.on('reconnect', () => {
        showAlert('Connection restored!', 'success');
    });
    
    // Add handler for coin updates
    socket.on('coins_update', (data) => {
        updateCoinDisplay(data.coins);
        showCoinNotification(data.earned, data.reason);
    });
};

// SmashCoins display update function
const updateCoinDisplay = (newAmount) => {
    const coinDisplay = document.querySelector('.coin-value');
    if (!coinDisplay) return;
    
    // Update the displayed value
    coinDisplay.textContent = newAmount;
    
    // Add animation class
    coinDisplay.parentElement.classList.add('updated');
    
    // Remove animation class after animation completes
    setTimeout(() => {
        coinDisplay.parentElement.classList.remove('updated');
    }, 500);
};

// Show coin notification when coins are earned or spent
const showCoinNotification = (amount, reason) => {
    // Create notification element if it doesn't exist
    let notification = document.getElementById('coinNotification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'coinNotification';
        notification.className = 'coin-notification';
        document.body.appendChild(notification);
    }
    
    // Set content based on whether coins were earned or spent
    const isPositive = amount > 0;
    notification.className = `coin-notification ${isPositive ? 'positive' : 'negative'}`;
    
    notification.innerHTML = `
        <div class="coin-amount">${isPositive ? '+' : ''}${amount} SmashCoins</div>
        <div class="coin-reason">${reason}</div>
    `;
    
    // Show notification
    setTimeout(() => notification.classList.add('show'), 10);
    
    // Hide notification after a delay
    setTimeout(() => {
        notification.classList.add('fade-out');
        setTimeout(() => {
            notification.classList.remove('show', 'fade-out');
        }, 300);
    }, 3000);
};

// Card animations
const animateCard = (element, animation) => {
    return new Promise(resolve => {
        element.classList.add(animation);
        element.addEventListener('animationend', () => {
            element.classList.remove(animation);
            resolve();
        }, { once: true });
    });
};

// Element animations
const elementAnimations = {
    fire: 'burning',
    water: 'ripple',
    air: 'wind',
    earth: 'rumble'
};

const playElementAnimation = (element, elementType) => {
    const animation = elementAnimations[elementType];
    if (animation) {
        element.classList.add(animation);
        setTimeout(() => element.classList.remove(animation), 1000);
    }
};

// Handle card capture animation
const captureCard = async (cardElement, direction = 'horizontal') => {
    cardElement.classList.add('capturing', direction);
    await new Promise(resolve => setTimeout(resolve, 300));
    cardElement.classList.remove('capturing', direction);
};

// Handle error responses
const handleApiError = async (response) => {
    if (!response.ok) {
        const error = await response.json();
        showAlert(error.message || 'An error occurred', 'error');
        throw new Error(error.message || 'API Error');
    }
    return response.json();
};

// Fetch and update coin balance from the server
const fetchCoinBalance = async () => {
    try {
        const response = await fetch('/api/coins');
        const data = await response.json();
        updateCoinDisplay(data.coins);
    } catch (error) {
        console.error('Error fetching coin balance:', error);
    }
};

// Initialize coin display when the page loads
document.addEventListener('DOMContentLoaded', () => {
    fetchCoinBalance();
});