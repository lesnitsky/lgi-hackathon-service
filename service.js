import Koa from 'koa';
import route from 'koa-route';
import Twitter from 'twitter';

import serveStatic from 'koa-static';

const consumer_key = process.env.HN_CONSUMER_KEY
const consumer_secret = process.env.HN_CONSUMER_SECRET;
const access_token_key = process.env.HN_ACCESS_TOKEN;
const access_token_secret = process.env.HN_ACCESS_TOKEN_SECRET;

import { server as WebSocketServer } from 'websocket';
import { OAuth } from 'oauth';
import qr from 'qr-image';

import session from 'koa-session';
import convert from 'koa-convert';

const client = new Twitter({ consumer_key, consumer_secret, access_token_key, access_token_secret });
const app = new Koa();
app.use(convert(session(app)));

app.use(serveStatic(process.cwd() + '/public'));

app.use(async (ctx, next) => {
	ctx.set('Access-Control-Allow-Origin', '*');
	await next();
})

app.use(async (ctx, next) => {
	console.log(ctx.cookies.get('oauth_token'));
	console.log(ctx.cookies.get('oauth_secret'));

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
}));

app.use(route.get('/auth-url-qr.png', async (ctx, next) => {
	const REQUEST_TOKEN_URL = 'https://api.twitter.com/oauth/request_token';
	const ACCESS_TOKEN_URL = 'https://api.twitter.com/oauth/access_token';
	const OAUTH_VERSION = '1.0';
	const HASH_VERSION = 'HMAC-SHA1';
	const oa = new OAuth(REQUEST_TOKEN_URL, ACCESS_TOKEN_URL, consumer_key, consumer_secret, OAUTH_VERSION, 'oob', HASH_VERSION);

	const { oauth_token, oauth_token_secret } = await new Promise((resolve, reject) => {
		oa.getOAuthRequestToken(function (error, oauth_token, oauth_token_secret, results) {
			if (error) {
				return reject(error)
			}

			resolve({
				oauth_token,
				oauth_token_secret,
			});
		});
	});

	const qrPNG = qr.imageSync(`https://api.twitter.com/oauth/authorize?oauth_token=${oauth_token}`, { type: 'png' });

	ctx.cookies.set('oauth_token', oauth_token);
	ctx.cookies.set('oauth_secret', oauth_token_secret);

	ctx.type = 'image/png';
	ctx.body = qrPNG;
}));

app.use(route.post('/oauth-pin', async (ctx, next) => {

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
