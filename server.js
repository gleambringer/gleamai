const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Game Constants
const WORLD_SIZE = 3000;
const INITIAL_RADIUS = 20;
const FOOD_COUNT = 200;
const AI_COUNT = 12; // Balanced number of autonomous bots

let players = {};
let bots = {};
let food = [];

// Helper: Generate random position within safe boundaries
const randomPos = () => Math.floor(Math.random() * (WORLD_SIZE - 100)) + 50;

// Initialize Food Fragments
for (let i = 0; i < FOOD_COUNT; i++) {
    food.push({
        id: i,
        x: randomPos(),
        y: randomPos(),
        color: `hsl(${Math.random() * 360}, 70%, 60%)`
    });
}

// Initialize AI Bots
for (let i = 0; i < AI_COUNT; i++) {
    const botId = `bot_${i}`;
    bots[botId] = {
        id: botId,
        name: `Bot_${i + 1}`,
        x: randomPos(),
        y: randomPos(),
        radius: INITIAL_RADIUS + Math.random() * 15,
        color: `hsl(${Math.random() * 360}, 50%, 45%)`,
        score: Math.random() * 10,
        isBot: true,
        targetAngle: Math.random() * Math.PI * 2
    };
}

io.on('connection', (socket) => {
    socket.emit('init', { worldSize: WORLD_SIZE, id: socket.id });

    socket.on('join', (data) => {
        players[socket.id] = {
            id: socket.id,
            x: randomPos(),
            y: randomPos(),
            radius: INITIAL_RADIUS,
            color: data.color || '#9d174d',
            name: data.name || 'Guest',
            score: 0,
            boosting: false
        };
    });

    socket.on('respawn', (data) => {
        if (players[socket.id]) {
            players[socket.id].x = randomPos();
            players[socket.id].y = randomPos();
            players[socket.id].radius = INITIAL_RADIUS;
            players[socket.id].score = 0;
        }
    });

    socket.on('move', (keys) => {
        const player = players[socket.id];
        if (!player) return;

        let speed = keys.boost && player.score > 5 ? 5 : 3;
        
        // Mass decay when boosting
        if (keys.boost && player.score > 5) {
            player.score -= 0.04;
            player.radius = INITIAL_RADIUS + Math.sqrt(player.score) * 2;
        }

        if (keys.up) player.y -= speed;
        if (keys.down) player.y += speed;
        if (keys.left) player.x -= speed;
        if (keys.right) player.x += speed;

        player.boosting = keys.boost;

        // Boundary checks
        player.x = Math.max(player.radius, Math.min(WORLD_SIZE - player.radius, player.x));
        player.y = Math.max(player.radius, Math.min(WORLD_SIZE - player.radius, player.y));
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

// Main Simulation Loop (AI Behavior & Physics)
setInterval(() => {
    const allEntities = { ...players, ...bots };

    // Update Bot AI
    Object.values(bots).forEach(bot => {
        let threat = null;
        let foodTarget = null;
        let closestFoodDist = 300;

        // 1. Detection (Threats vs Opportunities)
        Object.values(allEntities).forEach(other => {
            if (other.id === bot.id) return;
            const d = Math.hypot(bot.x - other.x, bot.y - other.y);
            // Fear: Run from larger entities
            if (other.radius > bot.radius * 1.15 && d < 250) {
                threat = other;
            }
        });

        if (threat) {
            // Flee logic
            const angle = Math.atan2(bot.y - threat.y, bot.x - threat.x);
            bot.x += Math.cos(angle) * 2.8;
            bot.y += Math.sin(angle) * 2.8;
        } else {
            // Foraging logic
            food.forEach(f => {
                const d = Math.hypot(bot.x - f.x, bot.y - f.y);
                if (d < closestFoodDist) {
                    closestFoodDist = d;
                    foodTarget = f;
                }
            });

            if (foodTarget) {
                const angle = Math.atan2(foodTarget.y - bot.y, foodTarget.x - bot.x);
                bot.x += Math.cos(angle) * 2.2;
                bot.y += Math.sin(angle) * 2.2;
            } else {
                // Wandering
                bot.x += Math.cos(bot.targetAngle) * 1.5;
                bot.y += Math.sin(bot.targetAngle) * 1.5;
                if (Math.random() < 0.02) bot.targetAngle = Math.random() * Math.PI * 2;
            }
        }

        // Keep bots in bounds
        bot.x = Math.max(bot.radius, Math.min(WORLD_SIZE - bot.radius, bot.x));
        bot.y = Math.max(bot.radius, Math.min(WORLD_SIZE - bot.radius, bot.y));
    });

    // Handle All Collisions
    const entitiesList = [...Object.values(players), ...Object.values(bots)];

    entitiesList.forEach(entity => {
        // 1. Food Consumption
        food.forEach((dot, idx) => {
            if (Math.hypot(entity.x - dot.x, entity.y - dot.y) < entity.radius) {
                entity.score += 1;
                entity.radius = INITIAL_RADIUS + Math.sqrt(entity.score) * 2;
                food[idx] = { id: idx, x: randomPos(), y: randomPos(), color: `hsl(${Math.random() * 360}, 70%, 60%)` };
            }
        });

        // 2. Entity Interaction (Predator/Prey)
        entitiesList.forEach(other => {
            if (entity.id === other.id) return;
            const dist = Math.hypot(entity.x - other.x, entity.y - other.y);
            
            // Only eat if significant size difference exists
            if (dist < entity.radius * 0.9 && entity.radius > other.radius * 1.15) {
                entity.score += Math.floor(other.score + 10);
                entity.radius = INITIAL_RADIUS + Math.sqrt(entity.score) * 2;
                
                if (other.isBot) {
                    // Respawn the bot
                    other.x = randomPos();
                    other.y = randomPos();
                    other.score = 5;
                    other.radius = INITIAL_RADIUS + Math.sqrt(other.score) * 2;
                } else {
                    io.to(other.id).emit('dead');
                    delete players[other.id];
                }
            }
        });
    });

    // Broadcast State
    const leaderboard = Object.values(allEntities)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(p => ({ name: p.name, score: Math.floor(p.score) }));

    io.emit('gameState', { players, bots, food, leaderboard });
}, 1000 / 60);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server live on port ${PORT}`));
