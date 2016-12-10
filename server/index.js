'use strict'

const MAX_PLAYERS = 8,
	GAMES = 'games',
	NAME = 'name',
	PLAYERS = 'players',
	STATE = 'state'

var fs = require('fs'),
	path = require('path'),
	readline = require('readline'),
	WebSocketServer = require('ws').Server,
	wss = new WebSocketServer({port: 63378}),
	emptyArray = [],
	gamesDir = path.join(__dirname, GAMES),
	playerSerial = 0

wss.on('connection', function(ws) {
	var playerId = ++playerSerial,
		currentGameDir = null,
		stateFile = null

	function sendJSON(obj) {
		ws.send(JSON.stringify(obj))
	}

	function sendOk(obj) {
		sendJSON(Object.assign({success: true}, obj))
	}

	function sendError(message) {
		sendJSON({success: false, error: message})
	}

	function getPlayers(gameDir) {
		var playersDir = path.join(gameDir || currentGameDir, PLAYERS)
		return fs.existsSync(playersDir) ?
			fs.readdirSync(playersDir) :
			emptyArray
	}

	function getNumberOfPlayers(gameDir) {
		return getPlayers(gameDir).length
	}

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

	function listGames() {
		fs.readdir(gamesDir, function(err, list) {
			if (err) {
				sendError('no games available')
			}
			var files = list.length
			if (files > 999) {
				sendError('too many games, please wait some time and retry')
				return
			}
			var now = Date.now(),
				games = []
			for (var i = files; i--;) {
				var gameId = list[i],
					gameDir = path.join(gamesDir, gameId),
					createdFile = path.join(gameDir, CREATED)
				if (!fs.lstatSync(gameDir).isDirectory() ||
						!fs.existsSync(createdFile)) {
					fs.unlinkSync(gameDir)
				}
				var created = fd.readFileSync(createdFile)
				if (!created || now - created > 86400000) {
					removeDirectory(gameDir)
					continue
				}
				var players = getNumberOfPlayers(gameDir)
				if (players < MAX_PLAYERS) {
					games.push({
						gameId: gameId,
						name: fd.readFileSync(path.join(gameDir, NAME)),
						players: players})
				}
			}
			sendOk({list: games}))
		})
	}

	function updateClient(event, filename) {
		sendOk({update: fs.readFileSync(filename)})
	}

	function addPlayerToGame(gameDir, playerId) {
		fs.mkdirSync(path.join(gameDir, PLAYERS, playerId))
		stateFile = path.join(gameDir, STATE)
		fs.watch(stateFile, updateClient)
		currentGameDir = gameDir
	}

	function createInitialState() {
		return {
			width: 5,
			height: 5,
			map: [
				0, 0, 0, 0, 0,
				0, 0, 0, 0, 0,
				0, 0, 0, 0, 0,
				0, 0, 0, 0, 0,
				0, 0, 0, 0, 0],
		}
	}

	function getState() {
		return fs.existsSync(stateFile) ?
			JSON.parse(fs.readFileSync(stateFile)) :
			null
	}

	function setState(state) {
		fs.writeFileSync(stateFile, JSON.stringify(state))
	}

	function createGame(json) {
		if (!json || !json.name) {
			sendError('missing name')
			return
		}
		var gameDir = path.join(gamesDir, playerId)
		if (fs.existsSync(gameDir)) {
			sendError('you already created a game')
			return
		}
		fs.mkdirSync(gameDir)
		fs.mkdirSync(path.join(gameDir, PLAYERS))
		fs.writeFileSync(path.join(gameDir, NAME), json.name)
		stateFile = path.join(gameDir, STATE)
		setState(createInitialState())
		addPlayerToGame(gameDir, playerId)
		sendOk()
	}

	function joinGame(json) {
		if (!json || !json.gameId) {
			sendError('missing gameId')
			return
		}
		var gameDir = path.join(gamesDir, json.gameId)
		if (!fs.existsSync(gameDir)) {
			sendError('game does not exist')
			return
		}
		if (getNumberOfPlayers(gameDir) >= MAX_PLAYERS) {
			sendError('already full')
			return
		}
		addPlayerToGame(gameDir, playerId)
		sendOk()
	}

	function leaveGame() {
		if (currentGameDir) {
			removeDirectory(path.join(currentGameDir, PLAYERS, playerId))
			if (getNumberOfPlayers(currentGameDir) < 1) {
				removeDirectory(currentGameDir)
			} else {
				// update state with new number of players
			}
		}
		currentGameDir = null
	}

	function removeGame() {
		leaveGame()
		removeDirectory(path.join(gamesDir, playerId))
	}

	function getOffset(state, x, y) {
		return Math.round(y * state.height + state.x) % state.length
	}

	function getCell(state, x, y) {
		return state.map[getOffset(state, x, y)]
	}

	function setCell(state, x, y, content) {
		state.map[getOffset(state, x, y)] = content
	}

	function isInGame() {
		if (!currentGameDir || !fs.existsSync(currentGameDir)) {
			sendError('you are not part of a game yet')
			return false
		}
		var playerDir = path.join(currentGameDir, PLAYERS, playerId)
		if (!fs.existsSync(playerDir)) {
			sendError('you are not part of this game')
			return false
		}
		return true
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

	function startGame() {
		if (!isInGame()) {
			return
		}
		var playerIds = getPlayers()
		if (playerIds.length < 2) {
			sendError('not enough players to start')
			return
		}
		var state = getState(),
			width = state.width,
			height = state.height,
			players = []
		for (var i = playerIds.length; i--;) {
			var playerId = playerIds[i],
				x,
				y

			do {
				x = width * Math.random() | 0
				y = height * Math.random() | 0
			} while (getPlayerByPosition(players, x, y) > 0)

			players.push({
				id: playerId,
				x: x,
				y: y})
		}
		state.turn = playerIds[0]
		state.players = playerInfos
		setState(state)
	}

	function getPlayerFromState(state) {
		var players = state.players
		for (var i = players.length; i--;) {
			var player = players[i]
			if (player.id === playerId) {
				return player
			}
		}
		return null
	}

	function getCheckedState() {
		if (!isInGame()) {
			return null
		}
		var state = getState()
		if (state.turn !== playerId) {
			sendError('it is not your turn')
			return null
		}
		var player = getPlayerFromState(state)
		if (!player) {
			sendError('player not in current game')
			return null
		}
		return state
	}

	function playerAttack() {
		var state = getCheckedState()
		if (!state) {
			return
		}
		// attack another player
	}

	function playerMove() {
		var state = getCheckedState()
		if (!state) {
			return
		}
		// move player to new position
	}

	ws.on('message', function(message) {
		var json = JSON.parse(message)
		switch (json.cmd) {
		default:
			sendError('missing command')
			break
		case 'list':
			listGames()
			break
		case 'remove':
			removeGame()
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
			joinGame(json)
			break
		case 'attack':
			playerAttack()
			break
		case 'move':
			playerMove()
			break
		}
	})

	ws.on('close', function(message) {
		leaveGame()
	})
})
