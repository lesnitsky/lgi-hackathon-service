var ws = window.ws = new WebSocket('ws://10.6.3.233:9889/' + window.location.search);

ws.onmessage = function onmessage(msg) {
	const data = JSON.parse(msg.data);
	console.log(data);
}

ws.onclose = function onclose() {
	console.log('Connection closed');
}
