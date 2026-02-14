// ============================================================
// Numbers Game — peer-to-peer multiplayer via PeerJS
// ============================================================

const QUESTIONS = [
    { question: "How long did it take to build the Golden Gate Bridge?", answer: 4, unit: "years" },
    { question: "How many bones are in the adult human body?", answer: 206, unit: "bones" },
    { question: "How tall is the Eiffel Tower?", answer: 330, unit: "meters" },
    { question: "What is the diameter of the Earth?", answer: 12742, unit: "kilometers" },
    { question: "How many languages are spoken in the world?", answer: 7168, unit: "languages" },
    { question: "How fast can a cheetah run?", answer: 120, unit: "km/h" },
    { question: "How old is the Great Wall of China?", answer: 2300, unit: "years" },
    { question: "How many stairs are in the Empire State Building?", answer: 1576, unit: "stairs" },
    { question: "What is the population of Tokyo?", answer: 14000000, unit: "people" },
    { question: "How hot is the surface of the Sun?", answer: 5500, unit: "degrees Celsius" },
    { question: "How deep is the Mariana Trench?", answer: 11034, unit: "meters" },
    { question: "How many islands does Indonesia have?", answer: 17508, unit: "islands" },
    { question: "How long is the Amazon River?", answer: 6400, unit: "kilometers" },
    { question: "How many keys are on a standard piano?", answer: 88, unit: "keys" },
    { question: "How many paintings did Van Gogh create?", answer: 900, unit: "paintings" },
    { question: "How many times does the average heart beat per day?", answer: 100000, unit: "beats" },
    { question: "How many pages are in the first Harry Potter book?", answer: 309, unit: "pages" },
    { question: "What year was the first email sent?", answer: 1971, unit: "" },
    { question: "How many feet tall is Mount Everest?", answer: 29032, unit: "feet" },
    { question: "How many minutes does it take sunlight to reach Earth?", answer: 8, unit: "minutes" },
];

const ROUNDS_PER_GAME = 10;
const ROUND_TIME = 30; // seconds

// ---- State ----
let isHost = false;
let peer = null;
let connections = {}; // peerId -> connection
let hostConn = null;  // client's connection to host

let myName = '';
let myId = '';
let roomCode = '';

// Host-only state
let players = {};       // peerId -> { name, score }
let gameQuestions = [];  // shuffled subset for this game
let currentRound = 0;
let answers = {};        // peerId -> number (for current round)
let roundTimer = null;

// Overlay state — tracks who has answered in the current round
let overlayData = []; // [{ id, name, score, isHost, answered }]
let cachedPlayerList = []; // client-side cache of player list from host

// ---- DOM ----
const $ = (id) => document.getElementById(id);

const screens = {
    home: $('screen-home'),
    lobby: $('screen-lobby'),
    question: $('screen-question'),
    results: $('screen-results'),
    gameover: $('screen-gameover'),
};

function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');

    // Show overlay during question and results screens
    const showOverlay = (name === 'question' || name === 'results');
    $('player-overlay').classList.toggle('hidden', !showOverlay);
}

// ---- Player Overlay ----
function buildOverlayData(answeredSet) {
    const list = isHost ? getFullPlayerList() : cachedPlayerList;
    overlayData = list.map(p => ({
        id: p.id,
        name: p.name,
        score: p.score || 0,
        isHost: p.isHost,
        answered: answeredSet ? answeredSet.has(p.id) : false,
    }));
}

function renderOverlay() {
    const container = $('overlay-players');
    container.innerHTML = '';
    overlayData.forEach(p => {
        const div = document.createElement('div');
        div.className = 'overlay-pip' + (p.id === myId ? ' is-me' : '');
        div.innerHTML = `
            <span class="pip-status ${p.answered ? 'answered' : 'waiting'}"></span>
            <span class="pip-name">${escapeHtml(p.name)}</span>
            <span class="pip-score">${formatNumber(p.score)}</span>
        `;
        container.appendChild(div);
    });
}

function markOverlayAnswered(playerId) {
    const p = overlayData.find(d => d.id === playerId);
    if (p) p.answered = true;
    renderOverlay();
}

// ---- Utilities ----
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
}

function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

function formatNumber(n) {
    return Number(n).toLocaleString();
}

function setStatus(elementId, msg, isSuccess) {
    const el = $(elementId);
    el.textContent = msg;
    el.className = 'status-msg' + (isSuccess ? ' success' : '');
}

// ---- Scoring ----
// Points based on percentage closeness: 1000 * (1 - error/answer), min 0
// Then round to nearest int. Exact = 1000 pts.
function calcPoints(guess, answer) {
    if (answer === 0) return guess === 0 ? 1000 : 0;
    const error = Math.abs(guess - answer);
    const ratio = error / Math.abs(answer);
    return Math.max(0, Math.round(1000 * (1 - ratio)));
}

// ============================================================
// HOST LOGIC
// ============================================================

function createGame() {
    $('btn-create').disabled = true;
    setStatus('home-status', 'Creating game...', true);

    roomCode = generateRoomCode();
    isHost = true;

    peer = new Peer('numbers-' + roomCode, {
        debug: 0,
    });

    peer.on('open', (id) => {
        myId = id;
        setStatus('home-status', '', true);
        showScreen('lobby');
        $('lobby-room-code').textContent = roomCode;
        $('btn-start').classList.remove('hidden');
        // Host enters name
        renderLobbyForHost();
    });

    peer.on('connection', (conn) => {
        if (Object.keys(connections).length >= 7) {
            conn.on('open', () => {
                conn.send({ type: 'error', message: 'Game is full (max 8 players).' });
                setTimeout(() => conn.close(), 500);
            });
            return;
        }
        setupHostConnection(conn);
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        if (err.type === 'unavailable-id') {
            setStatus('home-status', 'Room code taken. Try again.');
            $('btn-create').disabled = false;
            roomCode = generateRoomCode();
            peer.destroy();
            createGame();
        } else {
            setStatus('home-status', 'Connection error: ' + err.message);
            $('btn-create').disabled = false;
        }
    });
}

function setupHostConnection(conn) {
    conn.on('open', () => {
        connections[conn.peer] = conn;
        // Ask for name
        conn.send({ type: 'request-name' });
    });

    conn.on('data', (data) => handleHostMessage(conn, data));

    conn.on('close', () => {
        delete connections[conn.peer];
        delete players[conn.peer];
        broadcastPlayerList();
        renderLobbyForHost();
    });
}

function handleHostMessage(conn, data) {
    switch (data.type) {
        case 'set-name':
            players[conn.peer] = { name: data.name, score: 0 };
            broadcastPlayerList();
            renderLobbyForHost();
            break;

        case 'answer':
            if (answers[conn.peer] === undefined) {
                answers[conn.peer] = data.value;
                // Update overlay locally and broadcast status
                markOverlayAnswered(conn.peer);
                broadcastAnswerStatus();
                checkAllAnswered();
            }
            break;
    }
}

function broadcastPlayerList() {
    const list = getPlayerList();
    Object.values(connections).forEach(conn => {
        conn.send({ type: 'player-list', players: list });
    });
}

function broadcastAnswerStatus() {
    const answeredIds = Object.keys(answers);
    Object.values(connections).forEach(conn => {
        conn.send({ type: 'answer-status', answeredIds });
    });
}

function getPlayerList() {
    const list = [];
    // Add host
    if (myName) list.push({ id: myId, name: myName, score: 0, isHost: true });
    // Add connected players
    for (const [peerId, info] of Object.entries(players)) {
        list.push({ id: peerId, name: info.name, score: info.score, isHost: false });
    }
    return list;
}

function getFullPlayerList() {
    // Includes host with score
    const list = [];
    if (myName) list.push({ id: myId, name: myName, score: hostScore(), isHost: true });
    for (const [peerId, info] of Object.entries(players)) {
        list.push({ id: peerId, name: info.name, score: info.score, isHost: false });
    }
    return list;
}

let _hostScore = 0;
function hostScore() { return _hostScore; }

function renderLobbyForHost() {
    const list = getPlayerList();
    renderPlayerList(list);
    $('btn-start').classList.toggle('hidden', list.length < 1);
}

// ---- Host: Game Flow ----
function hostStartGame() {
    gameQuestions = shuffleArray(QUESTIONS).slice(0, ROUNDS_PER_GAME);
    currentRound = 0;
    _hostScore = 0;

    // Reset scores
    for (const p of Object.values(players)) p.score = 0;

    // Notify all clients
    Object.values(connections).forEach(conn => {
        conn.send({ type: 'game-start', totalRounds: gameQuestions.length });
    });

    hostStartRound();
}

function hostStartRound() {
    const q = gameQuestions[currentRound];
    answers = {};

    // Send question to clients
    Object.values(connections).forEach(conn => {
        conn.send({
            type: 'question',
            question: q.question,
            unit: q.unit,
            round: currentRound + 1,
            totalRounds: gameQuestions.length,
            time: ROUND_TIME,
        });
    });

    // Build overlay with no one answered yet
    buildOverlayData(new Set());
    renderOverlay();

    // Show question screen for host
    showQuestionScreen(q, currentRound + 1, gameQuestions.length);
    startTimer(ROUND_TIME, () => hostEndRound());
}

function checkAllAnswered() {
    const expectedCount = Object.keys(connections).length;
    const hostAnswered = answers[myId] !== undefined;
    const clientsAnswered = Object.keys(connections).every(pid => answers[pid] !== undefined);

    if (hostAnswered && clientsAnswered) {
        // Everyone answered, end round early
        clearInterval(roundTimer);
        hostEndRound();
    }
}

function hostEndRound() {
    clearInterval(roundTimer);
    const q = gameQuestions[currentRound];

    // Build results
    const results = [];

    // Host answer
    const hostGuess = answers[myId] !== undefined ? answers[myId] : null;
    const hostPts = hostGuess !== null ? calcPoints(hostGuess, q.answer) : 0;
    _hostScore += hostPts;
    results.push({ name: myName, guess: hostGuess, points: hostPts, totalScore: _hostScore });

    // Client answers
    for (const [peerId, info] of Object.entries(players)) {
        const guess = answers[peerId] !== undefined ? answers[peerId] : null;
        const pts = guess !== null ? calcPoints(guess, q.answer) : 0;
        info.score += pts;
        results.push({ name: info.name, guess, points: pts, totalScore: info.score });
    }

    // Sort by points this round (descending)
    results.sort((a, b) => b.points - a.points);

    const isLastRound = currentRound >= gameQuestions.length - 1;

    // Send results to clients
    Object.values(connections).forEach(conn => {
        conn.send({
            type: 'round-results',
            answer: q.answer,
            unit: q.unit,
            results,
            round: currentRound + 1,
            totalRounds: gameQuestions.length,
            isLastRound,
        });
    });

    // Broadcast updated player list with new scores so client overlay stays current
    broadcastPlayerList();

    showResultsScreen(q.answer, q.unit, results, isLastRound);
    currentRound++;
}

function hostNextRound() {
    if (currentRound >= gameQuestions.length) {
        hostEndGame();
    } else {
        hostStartRound();
    }
}

function hostEndGame() {
    const standings = getFullPlayerList().sort((a, b) => b.score - a.score);

    Object.values(connections).forEach(conn => {
        conn.send({ type: 'game-over', standings });
    });

    showGameOverScreen(standings);
}

// ============================================================
// CLIENT LOGIC
// ============================================================

function joinGame() {
    const code = $('input-room-code').value.trim().toUpperCase();
    if (code.length !== 4) {
        setStatus('home-status', 'Enter a 4-letter room code.');
        return;
    }

    $('btn-join').disabled = true;
    setStatus('home-status', 'Connecting...', true);
    roomCode = code;

    peer = new Peer(undefined, { debug: 0 });

    peer.on('open', (id) => {
        myId = id;
        const conn = peer.connect('numbers-' + code, { reliable: true });

        conn.on('open', () => {
            hostConn = conn;
            setStatus('home-status', '', true);
            showScreen('lobby');
            $('lobby-room-code').textContent = code;
            // Show name input
            $('name-entry').classList.remove('hidden');
            $('btn-start').classList.add('hidden');
        });

        conn.on('data', (data) => handleClientMessage(data));

        conn.on('close', () => {
            setStatus('lobby-status', 'Disconnected from host.');
        });

        conn.on('error', (err) => {
            setStatus('home-status', 'Connection failed: ' + err.message);
            $('btn-join').disabled = false;
        });

        // Timeout
        setTimeout(() => {
            if (!hostConn) {
                setStatus('home-status', 'Could not find game. Check the code.');
                $('btn-join').disabled = false;
                peer.destroy();
            }
        }, 8000);
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        setStatus('home-status', 'Connection error. Check the code and try again.');
        $('btn-join').disabled = false;
    });
}

function handleClientMessage(data) {
    switch (data.type) {
        case 'request-name':
            // Show name input (already shown)
            break;

        case 'player-list':
            cachedPlayerList = data.players;
            renderPlayerList(data.players);
            break;

        case 'game-start':
            // Wait for first question
            break;

        case 'question':
            // Build overlay from the player list we have cached
            buildOverlayData(new Set());
            renderOverlay();
            showQuestionScreen(
                { question: data.question, unit: data.unit },
                data.round,
                data.totalRounds
            );
            startTimer(data.time, () => {
                // Time's up, submit nothing
                setStatus('answer-status', "Time's up!");
                $('btn-submit-answer').disabled = true;
            });
            break;

        case 'answer-status':
            // Update overlay with who has answered
            if (data.answeredIds) {
                const set = new Set(data.answeredIds);
                overlayData.forEach(p => p.answered = set.has(p.id));
                renderOverlay();
            }
            break;

        case 'round-results':
            clearInterval(roundTimer);
            showResultsScreen(data.answer, data.unit, data.results, data.isLastRound);
            break;

        case 'game-over':
            clearInterval(roundTimer);
            showGameOverScreen(data.standings);
            break;

        case 'error':
            setStatus('home-status', data.message);
            break;
    }
}

function sendAnswer(value) {
    if (isHost) {
        answers[myId] = value;
        markOverlayAnswered(myId);
        broadcastAnswerStatus();
        checkAllAnswered();
    } else if (hostConn) {
        hostConn.send({ type: 'answer', value });
        // Optimistically mark self as answered
        markOverlayAnswered(myId);
    }
}

// ============================================================
// SHARED UI
// ============================================================

function renderPlayerList(list) {
    const container = $('player-list');
    container.innerHTML = '';
    list.forEach(p => {
        const div = document.createElement('div');
        div.className = 'player-chip';
        div.innerHTML = `
            <span class="name">${escapeHtml(p.name || 'Joining...')}</span>
            ${p.isHost ? '<span class="badge">HOST</span>' : ''}
        `;
        container.appendChild(div);
    });
}

function showQuestionScreen(q, round, total) {
    showScreen('question');
    $('round-label').textContent = `Round ${round} / ${total}`;
    $('question-text').textContent = q.question;
    $('question-unit').textContent = q.unit ? `Answer in ${q.unit}` : '';
    $('input-answer').value = '';
    $('input-answer').disabled = false;
    $('btn-submit-answer').disabled = false;
    $('input-answer').focus();
    setStatus('answer-status', '');
}

function startTimer(seconds, onEnd) {
    let remaining = seconds;
    $('timer').textContent = remaining;
    $('timer').classList.remove('urgent');

    clearInterval(roundTimer);
    roundTimer = setInterval(() => {
        remaining--;
        $('timer').textContent = remaining;
        if (remaining <= 10) $('timer').classList.add('urgent');
        if (remaining <= 0) {
            clearInterval(roundTimer);
            onEnd();
        }
    }, 1000);
}

function showResultsScreen(answer, unit, results, isLastRound) {
    // Update overlay scores from results
    results.forEach(r => {
        const p = overlayData.find(d => d.name === r.name);
        if (p) {
            p.score = r.totalScore;
            p.answered = false; // reset for display on results screen
        }
    });
    renderOverlay();

    showScreen('results');
    $('results-title').textContent = 'Round Results';
    $('real-answer').textContent = formatNumber(answer) + (unit ? ' ' + unit : '');

    const roundList = $('round-results');
    roundList.innerHTML = '';
    results.forEach((r, i) => {
        const div = document.createElement('div');
        div.className = 'result-row' + (i === 0 ? ' first-place' : '');
        div.innerHTML = `
            <span class="rank">#${i + 1}</span>
            <span class="name">${escapeHtml(r.name)}</span>
            <span class="answer">${r.guess !== null ? formatNumber(r.guess) : 'No answer'}</span>
            <span class="points">+${r.points}</span>
        `;
        roundList.appendChild(div);
    });

    // Scoreboard
    const scoreboard = $('scoreboard');
    scoreboard.innerHTML = '';
    const sorted = [...results].sort((a, b) => b.totalScore - a.totalScore);
    sorted.forEach((r, i) => {
        const div = document.createElement('div');
        div.className = 'result-row' + (i === 0 ? ' first-place' : '');
        div.innerHTML = `
            <span class="rank">#${i + 1}</span>
            <span class="name">${escapeHtml(r.name)}</span>
            <span class="answer"></span>
            <span class="points">${formatNumber(r.totalScore)}</span>
        `;
        scoreboard.appendChild(div);
    });

    // Next round button (host only)
    const nextBtn = $('btn-next-round');
    if (isHost) {
        nextBtn.classList.remove('hidden');
        nextBtn.textContent = isLastRound ? 'See Final Results' : 'Next Round';
    } else {
        nextBtn.classList.add('hidden');
    }
}

function showGameOverScreen(standings) {
    showScreen('gameover');

    if (standings.length > 0) {
        $('winner-title').textContent = `${standings[0].name} Wins!`;
    }

    const container = $('final-standings');
    container.innerHTML = '';
    standings.forEach((p, i) => {
        const div = document.createElement('div');
        div.className = 'result-row' + (i === 0 ? ' first-place' : '');
        div.innerHTML = `
            <span class="rank">#${i + 1}</span>
            <span class="name">${escapeHtml(p.name)}</span>
            <span class="answer"></span>
            <span class="points">${formatNumber(p.score)}</span>
        `;
        container.appendChild(div);
    });
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// ============================================================
// EVENT LISTENERS
// ============================================================

$('btn-create').addEventListener('click', createGame);

$('btn-join').addEventListener('click', joinGame);

$('input-room-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinGame();
});

$('btn-set-name').addEventListener('click', () => {
    const name = $('input-player-name').value.trim();
    if (!name) {
        setStatus('lobby-status', 'Enter a name.');
        return;
    }
    myName = name;
    $('name-entry').classList.add('hidden');
    setStatus('lobby-status', '', true);

    if (isHost) {
        renderLobbyForHost();
    } else if (hostConn) {
        hostConn.send({ type: 'set-name', name });
    }
});

$('input-player-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-set-name').click();
});

$('btn-start').addEventListener('click', () => {
    if (!myName) {
        setStatus('lobby-status', 'Set your name first.');
        return;
    }
    hostStartGame();
});

$('btn-submit-answer').addEventListener('click', () => {
    const val = $('input-answer').value.trim();
    if (val === '') {
        setStatus('answer-status', 'Enter a number.');
        return;
    }
    const num = parseFloat(val);
    if (isNaN(num)) {
        setStatus('answer-status', 'Enter a valid number.');
        return;
    }
    sendAnswer(num);
    $('input-answer').disabled = true;
    $('btn-submit-answer').disabled = true;
    setStatus('answer-status', 'Answer locked in!', true);
});

$('input-answer').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-submit-answer').click();
});

$('btn-next-round').addEventListener('click', () => {
    hostNextRound();
});

$('btn-play-again').addEventListener('click', () => {
    if (isHost) {
        showScreen('lobby');
        renderLobbyForHost();
    } else {
        // Reload to go back to home
        window.location.reload();
    }
});

// ============================================================
// THE DOOR — T-REX EASTER EGG
// ============================================================

$('the-door').addEventListener('click', (e) => {
    e.stopPropagation();
    unleashTRex();
});

let trexUnleashed = false;

function unleashTRex() {
    if (trexUnleashed) return;
    trexUnleashed = true;

    const trex = $('trex');
    const door = $('the-door');
    const container = document.querySelector('#screen-home .container');

    // Step 1: Door shakes violently
    door.style.transition = 'none';
    let doorShakeCount = 0;
    const doorShake = setInterval(() => {
        const x = (Math.random() - 0.5) * 12;
        const y = (Math.random() - 0.5) * 8;
        door.style.transform = `translate(${x}px, ${y}px)`;
        doorShakeCount++;
        if (doorShakeCount > 15) {
            clearInterval(doorShake);
            door.style.transform = '';
            // Step 2: Door flies away
            launchElement(door, -200, -800, -720);
            setTimeout(() => beginDestruction(trex, container), 300);
        }
    }, 50);
}

function beginDestruction(trex, container) {
    // Show T-Rex entering from the right
    trex.classList.remove('hidden');
    trex.style.bottom = '0px';
    trex.style.right = '0px';
    trex.style.animation = 'trex-enter 0.8s ease-out forwards';

    // Screen shake
    document.body.classList.add('shake');
    setTimeout(() => document.body.classList.remove('shake'), 500);

    // Step 3: After T-Rex arrives, smash the UI elements
    setTimeout(() => {
        trex.style.animation = 'trex-stomp 0.4s ease-in-out 3';

        // Shake screen with each stomp
        let stompCount = 0;
        const stompShake = setInterval(() => {
            document.body.classList.add('shake');
            setTimeout(() => document.body.classList.remove('shake'), 400);
            stompCount++;
            if (stompCount >= 3) clearInterval(stompShake);
        }, 400);

        // Launch UI elements one by one
        const targets = container.querySelectorAll('.logo, .tagline, .btn-primary, .divider, .join-row, .status-msg');
        const targetArray = Array.from(targets);

        targetArray.forEach((el, i) => {
            setTimeout(() => {
                const dirX = (Math.random() - 0.5) * 1200;
                const dirY = -300 - Math.random() * 600;
                const rot = (Math.random() - 0.5) * 1080;
                launchElement(el, dirX, dirY, rot);

                // Shake on impact
                document.body.classList.add('shake');
                setTimeout(() => document.body.classList.remove('shake'), 300);
            }, i * 200);
        });

        // Step 4: After destruction, T-Rex turns to face the viewer
        setTimeout(() => {
            turnToFaceViewer(trex);
        }, targetArray.length * 200 + 600);

    }, 900);
}

function launchElement(el, dx, dy, rotation) {
    const rect = el.getBoundingClientRect();

    // Clone position to fixed
    el.classList.add('debris');
    el.style.left = rect.left + 'px';
    el.style.top = rect.top + 'px';
    el.style.width = rect.width + 'px';
    el.style.margin = '0';

    // Force reflow
    el.offsetHeight;

    // Animate with JS for physics feel
    let vx = dx / 60;
    let vy = dy / 60;
    let vr = rotation / 60;
    const gravity = 0.8;
    let x = 0, y = 0, r = 0;
    let frame = 0;

    function animateDebris() {
        vy += gravity;
        x += vx;
        y += vy;
        r += vr;
        vx *= 0.99;
        vr *= 0.98;
        frame++;

        el.style.transform = `translate(${x}px, ${y}px) rotate(${r}deg)`;
        el.style.opacity = Math.max(0, 1 - frame / 80);

        if (frame < 80) {
            requestAnimationFrame(animateDebris);
        } else {
            el.style.display = 'none';
        }
    }
    requestAnimationFrame(animateDebris);
}

function turnToFaceViewer(trex) {
    // Move T-Rex to center
    trex.style.animation = 'none';
    trex.style.transition = 'all 0.8s ease-in-out';
    trex.style.left = '50%';
    trex.style.right = 'auto';
    trex.style.bottom = '10%';
    trex.style.transform = 'translateX(-50%)';

    setTimeout(() => {
        // Scale up and face the viewer
        trex.style.transition = 'transform 0.6s ease-in-out';
        trex.style.transform = 'translateX(-50%) scale(1.8)';

        // Open the jaw
        const jawBottom = trex.querySelector('.trex-jaw-bottom');
        jawBottom.style.animation = 'jaw-open 0.4s ease-out 0.3s forwards';

        // Add a ROAR effect — screen goes red briefly
        setTimeout(() => {
            const roar = document.createElement('div');
            roar.style.cssText = `
                position: fixed; inset: 0; z-index: 9998;
                background: radial-gradient(circle at 50% 60%, transparent 30%, rgba(180, 20, 20, 0.3) 100%);
                pointer-events: none;
                animation: roar-flash 2s ease-out forwards;
            `;

            // Add roar keyframes dynamically
            if (!document.querySelector('#roar-style')) {
                const style = document.createElement('style');
                style.id = 'roar-style';
                style.textContent = `
                    @keyframes roar-flash {
                        0% { opacity: 0; }
                        20% { opacity: 1; }
                        100% { opacity: 0.6; }
                    }
                `;
                document.head.appendChild(style);
            }

            document.body.appendChild(roar);
        }, 600);
    }, 800);
}
