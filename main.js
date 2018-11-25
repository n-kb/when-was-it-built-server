"use strict";

const serverPort = 3000,
    http = require("http"),
    express = require("express"),
    app = express(),
    server = http.createServer(app),
    WebSocket = require("ws"),
    wss = new WebSocket.Server({ server });

var csv = require("fast-csv");
var BUILDINGS = []
var MAX_POINTS = 100
csv
    .fromPath("Buildings.csv", {headers:true})
    .on("data", function(data){
     BUILDINGS.push(data)
    })
    .on("end", function(){
     console.log("Buildings loaded!");
    });

var cities = ["accra", "berlin", "paris", "abuja", "tokyo", "boston"]
// randomizes the cities
cities.sort(function(a,b) { return Math.random() > 0.5; } );
var rooms = {}

function noop() {}

function heartbeat() {
  this.isAlive = true;
}

function removePlayer(ws) {
    // if user already in a room, empties it
    for (var room in rooms) {
        if (rooms.hasOwnProperty(room)) {
            // If player in another room, removes it
            for (var i=0; i<rooms[room].players.length; i++) {
                if (rooms[room].players[i].ws == ws) {
                    rooms[room].players.splice(i, 1)
                }
            }
            // deletes empty room
            if (rooms[room].players.length == 0) {
                delete rooms[room]
                //puts the city name back in the pool
                cities.push(room)
            }
        }
    }
}

function selectBuilding() {
    // Randomly selects one building
    var building = BUILDINGS[Math.floor(Math.random()*BUILDINGS.length)]
    return {"id": building.id, 
            "name": building.building_name,
            "photos": building.photos,
            "country": building.country,
            "city": building.city}
}

function checkAnswer(answer, building_id) {
    answer = Number(answer)
    var distance = MAX_POINTS + 1
    // Finds correct building
    for (var k=0; k<BUILDINGS.length; k++) {
        if (building_id == BUILDINGS[k].id) {
            var building = BUILDINGS[k]
            break
        }
    }
    if (answer >= building.date_start && answer <= building.date_end) {
        distance = 0
    } else if (answer < building.date_start) {
        distance = building.date_start - answer
    } else if (answer > building.date_end) {
        distance =  answer - building.date_end
    }
    var points = MAX_POINTS - distance
    if (points < 0) points = 0
    return { points: points, correct_answer: [building.date_start, building.date_end, building.building_name] }
}

//when a websocket connection is established
wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', heartbeat);
    ws.on('close', function close() {
      removePlayer(ws);
    });
    //when a message is received
    ws.on('message', (message) => {
        var message_json = JSON.parse(message)
        if (message_json.newRoom) {
            removePlayer(ws)
            // Chooses new room at random
            var roomName = cities.shift();
            rooms[roomName] = { players: [{name: message_json.username, ws: ws}]}
            ws.send(JSON.stringify({"roomName": roomName }))
        } else if (message_json.joinRoom) {
            var roomName = message_json.joinRoom
            // Adds second player to the room
            rooms[roomName].players.push({name: message_json.username, ws: ws})
            // Init the rounds
            rooms[roomName].rounds = {}
            // Selects first building
            var building = selectBuilding()
            // send message to other player
            rooms[roomName].players[0].ws.send(JSON.stringify(
                    {"newPlayerJoined": true, "playerName": message_json.username, "building": building }
                ))
            // sends name of opponent to player
            ws.send(JSON.stringify({"playerName": rooms[roomName].players[0].name, "building": building }))
        } else if (message_json.answer) {
            // needs: room, playername, answer, building_id
            // Checks if answer is correct
            var roomName = message_json.roomName
            var checked_answer = checkAnswer(message_json.answer, message_json.building_id)
            // Stores answer
            var round = rooms[roomName].rounds[message_json.round]
            // second one to answer
            if (round) {
                rooms[roomName].rounds[message_json.round][message_json.username] = {answer: message_json.answer,
                                                                                     points: checked_answer.points}
                // Sends a new question and the score for both
                var building = selectBuilding()
                for (var l=0; l<rooms[roomName].players.length; l++){
                    rooms[roomName].players[l].ws.send(JSON.stringify(
                        {round_summary: rooms[roomName].rounds[message_json.round], building: building}
                    ))
                }
            } else {
                //first one to answer
                rooms[roomName].rounds[message_json.round] = {}
                rooms[roomName].rounds[message_json.round][message_json.username] = {answer: message_json.answer,
                                                                                     points: checked_answer.points}
                rooms[roomName].rounds[message_json.round].correct_answer = checked_answer.correct_answer
            }           
        }
    });
});

const interval = setInterval(function ping() {
  wss.clients.forEach(function each(ws) {
    if (ws.isAlive === false) {
        // removes the room if user was alone
        removePlayer(ws)
        return ws.terminate()
    };
    ws.isAlive = false;
    ws.ping(noop);
  });
}, 1000);

//start the web server
server.listen(serverPort, () => {
    console.log(`Websocket server started on port ` + serverPort);
});