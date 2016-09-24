var ws = window.ws = new WebSocket('ws://10.6.3.233:9889/' + window.location.search);

ws.onmessage = function onmessage(msg) {
	const data = JSON.parse(msg.data);
	console.log(data);
}

ws.onclose = function onclose() {
	console.log('Connection closed');
}

const button = document.querySelector('button');
const pinInput = document.querySelector('input');

button.addEventListener('click', e => {
	const pin = pinInput.value;

	const headers = new Headers();
	headers.append('Content-Type', 'application/json');

	fetch('/oauth-pin', {
		method: 'POST',
		headers: headers,
		body: JSON.stringify({ pin }),
		credentials: 'include',
	});
});
