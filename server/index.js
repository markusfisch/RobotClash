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
	MOVES_PER_ROUND = 2,
	fs = require('fs'),
	path = require('path'),
	WebSocketServer = require('ws').Server,
	wss = new WebSocketServer({port: 63378}),
	emptyArray = [],
	gamesDir = path.join(__dirname, 'games'),
	playerSerial = 0

function removeDirectory(dir) {
	if (!fs.existsSync(dir)) {
		return
	}
	fs.readdirSync(dir).forEach(function(file, index) {
		file = path.join(dir, file)
		if (fs.lstatSync(file).isDirectory()) {
			removeDirectory(file)
		} else {
			fs.unlinkSync(file)
		}
	})
	fs.rmdirSync(dir)
}

if (fs.existsSync(gamesDir)) {
	removeDirectory(gamesDir)
}
fs.mkdirSync(gamesDir)

wss.on('connection', function(ws) {
	var playerId = ++playerSerial,
		currentGameFile = null,
		watcher = null

	function parseJson(s) {
		try {
			return JSON.parse(s)
		} catch (e) {
			return {}
		}
	}

	function sendJSON(obj) {
		try {
			ws.send(JSON.stringify(obj))
		} catch (e) {
			leaveGame()
		}
	}

	function sendOk(obj) {
		sendJSON(obj)
	}

	function sendError(message) {
		sendJSON({error: message})
	}

	function loadGame(gameFile) {
		gameFile = gameFile || currentGameFile
		return fs.existsSync(gameFile) ?
			parseJson(fs.readFileSync(gameFile)) :
			null
	}

	function saveGame(game) {
		if (currentGameFile) {
			fs.writeFileSync(currentGameFile, JSON.stringify(game))
		}
	}

	function getGamesList(list) {
		var now = Date.now(),
			games = []
		for (var i = Math.min(list.length, 999); i--;) {
			var gameId = list[i],
				gameFile = path.join(gamesDir, gameId.toString()),
				game = loadGame(gameFile)
			if (!game || now - game.created > 86400000) {
				fs.unlinkSync(gameFile)
				continue
			}
			var numberOfPlayers = game.players.length
			if (numberOfPlayers < MAX_PLAYERS && !game.started) {
				games.push({
					id: gameId,
					name: game.name,
					players: numberOfPlayers,
					maxPlayers: MAX_PLAYERS})
			}
		}
		return games
	}

	function listGames() {
		fs.readdir(gamesDir, function(err, list) {
			var games
			if (!err && list &&
					(games = getGamesList(list)) &&
					games.length > 0) {
				sendOk({games: games})
			} else {
				sendOk({games: 'no games available'})
			}
		})
	}

	function closeWatcher() {
		if (watcher) {
			watcher.close()
			watcher = null
		}
	}

	function watchGame(gameFile) {
		closeWatcher()
		watcher = fs.watch(gameFile, function() {
			if (!fs.existsSync(gameFile)) {
				watcher.close()
			} else {
				sendOk({update: loadGame()})
			}
		})
	}

	function createInitialGame(name) {
		return {
			created: Date.now(),
			started: 0,
			name: name,
			maxPlayers: MAX_PLAYERS,
			players: [],
			attacks: [],
			moves: [],
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

	function addPlayerToGame(game) {
		var players = game.players,
			color = PLAYER_COLORS[players.length]
		players.push({
			id: playerId,
			life: 1,
			moves: MOVES_PER_ROUND,
			color: color})
	}

	function findGameByName(name) {
		var gameIds = fs.readdirSync(gamesDir)
		if (!gameIds || gameIds.length < 1) {
			return null
		}
		for (var i = gameIds.length; i--;) {
			var gameId = gameIds[i],
				gameFile = path.join(gamesDir, gameId.toString()),
				game = loadGame(gameFile)
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
		var gameFile = path.join(gamesDir, playerId.toString())
		if (fs.existsSync(gameFile)) {
			sendError('you already created a game')
			return
		}
		var name = json.name.trim().toLowerCase().substring(0, 16)
		if (findGameByName(json.name)) {
			sendError('there is already a game of that name')
			return
		}
		currentGameFile = gameFile
		var game = createInitialGame(json.name)
		addPlayerToGame(game)
		saveGame(game)
		watchGame(gameFile)
		sendOk({created: playerId})
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
		var gameFile = path.join(gamesDir, json.gameId.toString()),
			game = loadGame(gameFile)
		if (!game) {
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
		currentGameFile = gameFile
		addPlayerToGame(game)
		saveGame(game)
		watchGame(gameFile)
		sendOk({joined: playerId})
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
		if (currentGameFile) {
			var game = loadGame()
			if (!game) {
				sendError('there is no game to leave')
				return
			}
			removePlayerFromGame(game, playerId)
			if (game.players.length < 1) {
				fs.unlinkSync(currentGameFile)
			} else {
				saveGame(game)
			}
		}
		currentGameFile = null
		closeWatcher()
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
				return player.id
			}
		}
		return 0
	}

	function findNextPlayer(game) {
		var players = game.players
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
		if (--player.moves < 1) {
			var next = findNextPlayer(game)
			next.moves = MOVES_PER_ROUND
			game.turn = next.id
		}
	}

	function startGame() {
		var game = loadGame()
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
			} while (getPlayerByPosition(players, x, y) > 0)

			player.x = x
			player.y = y
		}
		game.started = Date.now()
		game.turn = players[0].id
		saveGame(game)
	}

	function loadGameAndPlayer() {
		var game = loadGame(),
			player
		if (!game || !(player = getPlayerFromGame(game))) {
			sendError('you are not a part of this game yet')
			return null
		} else if (game.turn !== playerId) {
			sendError('it is not your turn')
			return null
		}
		return {game: game, player: player}
	}

	function getCheckedGame(game) {
		var player
		if (!game || !(player = getPlayerFromGame(game))) {
			sendError('you are not a part of this game yet')
			return null
		} else if (game.turn !== playerId) {
			sendError('it is not your turn')
			return null
		}
		return player
	}

	function playerAttack(json) {
		if (!json || !json.target) {
			sendError('missing attack target')
			return
		}
		var game = loadGame(),
			player = getCheckedGame(game)
		if (!player) {
			sendError('player not in game')
			return
		}
		var target = json.target,
			x = target.x,
			y = target.y,
			victim = getPlayerByPosition(players, x, y)
		if (!victim) {
			sendError('no target at given position')
			return
		}
		var ground = getCell(game, victim.x, victim.y)
		if (Math.random() > .5 / (ground + 1)) {
			var dx = victim.x - player.x,
				dy = victim.y - player.y,
				d = Math.sqrt(dx*dx + dy*dy),
				damage = 1 / d
			victim.life -= damage
			game.attacks.push({
				from: player.id,
				to: victim.id,
				damage: damage})
		}
		if (victim.life <= 0) {
			removePlayerFromGame(game, victim.id)
			if (game.players.length < 2) {
				game.winner = player.id
			}
		}
		nextMoveOrPlayer(game, player)
		saveGame(game)
	}

	function playerMove(json) {
		if (!json || !json.target) {
			sendError('missing a direction')
			return
		}
		var game = loadGame(),
			player = getCheckedGame(game)
		if (!player) {
			sendError('player not in game')
			return
		}
		var width = game.width,
			height = game.height,
			target = json.target,
			x = target.x,
			y = target.y
		if (x < 1 || x >= width - 1 ||
				y < 1 || y >= height - 1 ||
				getPlayerByPosition(players, x, y)) {
			sendError('illegal move')
			return
		}
		game.moves.push({
			playerId: player.id,
			fromX: player.x,
			fromY: player.y,
			toX: x,
			toY: y})
		player.x = x
		player.y = y
		nextMoveOrPlayer(game, player)
		saveGame(game)
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

	ws.on('close', function(message) {
		leaveGame()
	})
})
