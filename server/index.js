'use strict'

var PLAYER_COLORS = [
		{normal: '#b5ff00', dark: '#91cc00'},
		{normal: '#ffb400', dark: '#cc9000'},
		{normal: '#ff1100', dark: '#cd0e00'},
		{normal: '#ff00b8', dark: '#cc0093'},
		{normal: '#9a00ff', dark: '#7b00cc'},
		{normal: '#0046ff', dark: '#0038cc'},
		{normal: '#00fffe', dark: '#00cccb'},
		{normal: '#00ff5a', dark: '#00cc48'},
	],
	MAX_PLAYERS = PLAYER_COLORS.length,
	ACTIONS_PER_ROUND = 2,
	WebSocketServer = require('ws').Server,
	wss = new WebSocketServer({port: 63378}),
	games = [],
	updates = [],
	newGameListeners = [],
	playerSerial = 0

wss.on('connection', function(ws) {
	var playerId = ++playerSerial,
		lastUpdate = 0,
		currentGame = null

	function parseJson(s) {
		try {
			return JSON.parse(s)
		} catch (e) {
			return {}
		}
	}

	function sendJSON(obj) {
		try {
			//ws.send(JSON.stringify(obj))
			var s = JSON.stringify(obj)
console.log("send(" + s + ")");
			ws.send(s)
		} catch (e) {
console.log("error: " + e);
			leaveGame()
		}
	}

	function sendError(message) {
		sendJSON({error: message})
	}

	function getGames() {
		var list = []
		for (var idx in games) {
			var game = games[idx],
				numberOfPlayers
			if (game &&
					!game.started &&
					(numberOfPlayers = game.players.length) <
						game.maxPlayers) {
				list.push({
					id: idx,
					name: game.name,
					players: numberOfPlayers,
					maxPlayers: game.maxPlayers})
			}
		}
		return {games: list.length > 0 ? list : 'no games available'}
	}

	function listGames() {
		newGameListeners[playerId] = updateNewGame
		sendJSON(getGames())
	}

	function createInitialGame(name) {
		return {
			id: playerId,
			created: Date.now(),
			started: 0,
			name: name,
			maxPlayers: MAX_PLAYERS,
			players: [],
			width: 8,
			height: 8,
			map: [
				0, 0, 0, 0, 0, 0, 0, 0,
				0, 1, 0, 0, 0, 0, 1, 0,
				0, 0, 0, 2, 0, 0, 0, 0,
				0, 0, 0, 0, 0, 0, 0, 0,
				0, 0, 0, 0, 0, 0, 0, 0,
				0, 0, 0, 0, 2, 0, 0, 0,
				0, 1, 0, 0, 0, 0, 1, 0,
				0, 0, 0, 0, 0, 0, 0, 0,
			],
		}
	}

	function updateNewGame() {
		sendJSON(getGames())
	}

	function updateNewGameListeners() {
		for (var idx in newGameListeners) {
			var callback = newGameListeners[idx]
			if (callback) {
				callback()
			}
		}
	}

	function removeNewGameListener() {
		newGameListeners.splice(playerId, 1)
	}

	function updateClient() {
		var game = currentGame
		if (!game) {
			return
		}
		var ud = updates[game.id],
			len = ud.length
		for (var i = lastUpdate; i < len; ++i) {
			sendJSON(ud[i])
		}
		lastUpdate = len
	}

	function addUpdate(obj) {
		var game = currentGame
		if (game) {
			updates[game.id].push(obj)
			var players = game.players
			for (var i = players.length; i--;) {
				players[i].listener();
			}
		}
	}

	function addPlayerToGame(game) {
		var players = game.players,
			color = PLAYER_COLORS[players.length]
		players.push({
			id: playerId,
			life: 1,
			actions: ACTIONS_PER_ROUND,
			color: color,
			listener: updateClient})
	}

	function findGameByName(name) {
		for (var idx in games) {
			var game = games[idx]
			if (game && game.name === name) {
				return game
			}
		}
		return null
	}

	function createGame(json) {
		if (!json || !json.name) {
			sendError('missing name')
			return
		}
		if (games[playerId]) {
			sendError('you already created a game')
			return
		}
		var name = json.name.trim().toLowerCase().substring(0, 16)
		if (findGameByName(name)) {
			sendError('there is already a game of that name')
			return
		}
		currentGame = createInitialGame(name)
		addPlayerToGame(currentGame)
		games[playerId] = currentGame
		updates[playerId] = []
		sendJSON({created: playerId})
		updateNewGameListeners()
	}

	function getPlayerFromGame(game) {
		var players = game.players
		for (var i = players.length; i--;) {
			var player = players[i]
			if (player.id === playerId) {
				return player
			}
		}
		return null
	}

	function joinGame(json) {
		if (!json || !json.gameId) {
			sendError('missing gameId')
			return
		}
		var idx = parseInt(json.gameId),
			game
		if (idx < 1 || !(game = games[idx])) {
			sendError('game does not exist')
			return
		}
		if (game.started) {
			sendError('game already started')
			return
		}
		if (game.players.length >= MAX_PLAYERS) {
			sendError('already full')
			return
		}
		if (getPlayerFromGame(game)) {
			sendError('you are already in this game')
			return
		}
		currentGame = game
		addPlayerToGame(game)
		sendJSON({joined: playerId})
		addUpdate({
			players: game.players.length,
			maxPlayers: game.maxPlayers})
	}

	function removePlayerFromGame(game, id) {
		var players = game.players
		for (var i = players.length; i--;) {
			var player = players[i]
			if (player.id === id) {
				players.splice(i, 1)
				return true
			}
		}
		return false
	}

	function leaveGame() {
		if (currentGame) {
			removePlayerFromGame(currentGame, playerId)
			if (currentGame.players.length < 1) {
				var idx = currentGame.id
				games.splice(idx, 1)
				updates.splice(idx, 1)
			} else {
				addUpdate({remove: playerId})
			}
		}
		currentGame = null
	}

	function getOffset(game, x, y) {
		return Math.round(y * game.height + x) % game.map.length
	}

	function getCell(game, x, y) {
		return game.map[getOffset(game, x, y)]
	}

	function getPlayerByPosition(players, x, y) {
		for (var i = players.length; i--;) {
			var player = players[i]
			if (player.x === x && player.y === y) {
				return player
			}
		}
		return null
	}

	function findNextPlayer(game) {
		var players = game.players,
			len = players.length
		if (len < 1) {
			return -1
		}
		var atTurn = game.turn,
			i = 0
		for (; i < len; ++i) {
			var player = players[i]
			if (player.id === atTurn) {
				++i
				break
			}
		}
		return players[i % len]
	}

	function nextMoveOrPlayer(game, player) {
		if (--player.actions < 1) {
			var next = findNextPlayer(game)
			next.actions = ACTIONS_PER_ROUND
			game.turn = next.id
			addUpdate({turn: next.id})
		}
	}

	function startGame() {
		var game = currentGame
		if (!game || !getPlayerFromGame(game)) {
			sendError('you are not part of a game yet')
			return
		}
		if (game.players.length < 1) {
			sendError('not enough players to start')
			return
		}
		var width = game.width,
			height = game.height,
			players = game.players
		for (var i = players.length; i--;) {
			var player = players[i],
				x,
				y

			do {
				x = width * Math.random() | 0
				y = height * Math.random() | 0
			} while (getPlayerByPosition(players, x, y))

			player.x = x
			player.y = y
		}
		removeNewGameListener()
		game.started = Date.now()
		game.turn = players[0].id
		updateNewGameListeners()
		addUpdate({game: game})
	}

	function playerAttack(json) {
		if (!json ||
				typeof json.x === 'undefined' ||
				typeof json.y === 'undefined') {
			sendError('missing attack coordinates')
			return
		}
		var game = currentGame,
			player
		if (!game || !(player = getPlayerFromGame(game))) {
			sendError('player not in game')
			return
		}
		var x = parseInt(json.x),
			y = parseInt(json.y),
			players = game.players,
			victim = getPlayerByPosition(players, x, y)
		if (!victim) {
			return
		}
		var ground = getCell(game, victim.x, victim.y),
			attack = {
				attacker: player.id,
				victim: victim.id,
				damage: 0,
			}
		if (Math.random() > .5 / (ground + 1)) {
			var dx = victim.x - player.x,
				dy = victim.y - player.y,
				d = Math.sqrt(dx*dx + dy*dy)
			attack.damage = 1 / d
			victim.life -= attack.damage
		}
		if (victim.life <= 0) {
			addUpdate({remove: victim.id})
			removePlayerFromGame(game, victim.id)
		}
		nextMoveOrPlayer(game, player)
		addUpdate({attack: attack})
	}

	function playerMove(json) {
		if (!json ||
				typeof json.x === 'undefined' ||
				typeof json.y === 'undefined') {
			sendError('missing a destination')
			return
		}
		var game = currentGame,
			player
		if (!game || !(player = getPlayerFromGame(game))) {
			sendError('player not in game')
			return
		}
		var width = game.width,
			height = game.height,
			players = game.players,
			x = parseInt(json.x),
			y = parseInt(json.y)
		if (x < 0 || x >= width - 1 ||
				y < 0 || y >= height - 1) {
			sendError('out of bounds')
			return
		} else if (getPlayerByPosition(players, x, y)) {
			sendError('position already occupied')
			return
		}
		var move = {
			id: player.id,
			x: x,
			y: y}
		player.x = x
		player.y = y
		nextMoveOrPlayer(game, player)
		addUpdate({move: move})
	}

	ws.on('message', function(message) {
		var json = parseJson(message)
		switch (json.cmd) {
		default:
			sendError('missing command')
			break
		case 'list':
			listGames()
			break
		case 'create':
			createGame(json)
			break
		case 'leave':
			leaveGame()
			break
		case 'join':
			joinGame(json)
			break
		case 'start':
			startGame(json)
			break
		case 'attack':
			playerAttack(json)
			break
		case 'move':
			playerMove(json)
			break
		}
	})

	ws.on('close', function() {
		removeNewGameListener()
		leaveGame()
	})
})
