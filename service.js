import Koa from 'koa';
import route from 'koa-route';
import Twitter from 'twitter';
import TwitterPinAuth from 'twitter-pin-auth';

import serveStatic from 'koa-static';

const consumer_key = process.env.HN_CONSUMER_KEY
const consumer_secret = process.env.HN_CONSUMER_SECRET;
const access_token_key = process.env.HN_ACCESS_TOKEN;
const access_token_secret = process.env.HN_ACCESS_TOKEN_SECRET;

import { server as WebSocketServer } from 'websocket';


const client = new Twitter({ consumer_key, consumer_secret, access_token_key, access_token_secret });

const app = new Koa();

app.use(serveStatic(process.cwd() + '/public'));

app.use(async (ctx, next) => {
	ctx.set('Access-Control-Allow-Origin', '*');
	await next();
})

app.use(route.get('/ping', ctx => {
	ctx.body = 'Kek'
}));

app.use(route.get('/tweets', async (ctx, next) => {
	const { hashtags } = ctx.request.query;

	if (!hashtags) {
		ctx.status = 400;
		ctx.body = 'Missing "hashtags" param';
		return;
	}

	const tweets = await new Promise((resolve, reject) => {
		client.get('search/tweets', { q: hashtags.split(',').map(toHashTag).join(',') }, function (error, tweets, response) {
			if (error) {
				return reject(error);
			}

			resolve(tweets.statuses);
		})
	});

	ctx.body = tweets;
}))

const server = app.listen(9889);
console.log('Starting');

const wsServer = new WebSocketServer({
    httpServer: server,
    autoAcceptConnections: false
});

const Connections = new Set();
const trackedHashtags = new Set();
let twitsStream;

wsServer.on('request', (req) => {
	if (!req.resourceURL.query.hashtags) {
		req.reject();
	}

	connect(req);
})

function connect(req) {
	const connection = req.accept();
	const hashtags = req.resourceURL.query.hashtags.split(',');

	connection.hashtags = hashtags;
	Connections.add(connection);

	connection.on('close', () => {
		Connections.delete(connection);
	});

	const newHashtags = hashtags.filter(hashtag => !trackedHashtags.has(hashtag));

	if (newHashtags.length === 0) {
		return;
	}

	if (twitsStream) {
		twitsStream.removeAllListeners();
		twitsStream.destroy();
	}

	newHashtags.forEach(tag => trackedHashtags.add(tag));

	const streamTrack = Array.from(trackedHashtags.keys()).map(toHashTag).join(',');

	console.log(trackedHashtags);
	console.log(streamTrack);

	twitsStream = client.stream('statuses/filter', { track: streamTrack });

	twitsStream.on('data', function(event) {
		Connections.forEach(connection => {
			if (!connection.hashtags.some(hashtag => containsHashtag(event, hashtag))) {
				return;
			}

			connection.sendUTF(JSON.stringify(event));
		});
	});

	twitsStream.on('error', function(error) {
		console.log(error);
		Connections.forEach(connection => connection.close())
	});
}

function containsHashtag(event, hashtag) {
	console.log(event.entities.hashtags);
	try {
		return event.entities.hashtags.filter(tag => tag.text.toLowerCase() === hashtag.toLowerCase()).length > 0;
	} catch (err) {
		return false;
	}
}

function toHashTag(tagText) {
	return `#${tagText}`
}
