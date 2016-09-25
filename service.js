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
import bodyParser from 'koa-bodyparser';

import cors from 'kcors';

const client = new Twitter({ consumer_key, consumer_secret, access_token_key, access_token_secret });

const REQUEST_TOKEN_URL = 'https://api.twitter.com/oauth/request_token';
const ACCESS_TOKEN_URL = 'https://api.twitter.com/oauth/access_token';
const OAUTH_VERSION = '1.0';
const HASH_VERSION = 'HMAC-SHA1';
const oa = new OAuth(REQUEST_TOKEN_URL, ACCESS_TOKEN_URL, consumer_key, consumer_secret, OAUTH_VERSION, 'oob', HASH_VERSION);

const app = new Koa();
app.use(convert(session(app)));
app.use(bodyParser());
app.use(cors());

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
}));

app.use(route.get('/oauth-keys', async (ctx, next) => {
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

	ctx.body = {
		oauth_token,
		oauth_token_secret
	}
}));

app.use(route.get('/auth-url-qr.png', async (ctx, next) => {
	const { oauth_token } = ctx.request.query;

	const authUrl = `https://api.twitter.com/oauth/authorize?oauth_token=${oauth_token}&force_login=true`;
	const qrPNG = qr.imageSync(authUrl, { type: 'png' });

	ctx.set('X-Auth-Url', authUrl);

	ctx.type = 'image/png';
	ctx.body = qrPNG;
}));

app.use(route.post('/oauth-pin', async (ctx, next) => {
	const { pin, oauth_token, oauth_token_secret } = ctx.request.body;

	const { access_token, access_token_secret, profile } = await new Promise((resolve, reject) => {
		oa.getOAuthAccessToken(oauth_token, oauth_token_secret, pin, function (error, access_token, access_token_secret, profile) {
			if (error) {
				return reject(new Error(error.data));
			}

			resolve({ access_token, access_token_secret, profile })
		});
	});

	ctx.body = {
		profile,
		access_token,
		access_token_secret,
	};
}));

app.use(route.post('/retweet', async (ctx, next) => {
	const { id, access_token, access_token_secret } = ctx.request.body;
	const access_token_key = access_token;

	const client = new Twitter({ consumer_key, consumer_secret, access_token_key, access_token_secret });

	ctx.body = await new Promise((resolve, reject) => {
		client.post('statuses/retweet/' + id, (err, result, res) => {
			if (err) {
				console.log(result);
				return reject(new Error(err.data));
			}

			resolve(result);
		});
	});
}));

app.use(route.delete('/retweet', async (ctx, next) => {
	const { id, access_token, access_token_secret } = ctx.request.body;
	const access_token_key = access_token;

	const client = new Twitter({ consumer_key, consumer_secret, access_token_key, access_token_secret });

	ctx.body = await new Promise((resolve, reject) => {
		client.post('statuses/unretweet/' + id, (err, result, res) => {
			if (err) {
				console.log(result);
				return reject(new Error(err.data));
			}

			resolve(result);
		});
	});
}));

app.use(route.post('/like', async (ctx, next) => {
	const { id, access_token, access_token_secret } = ctx.request.body;
	const access_token_key = access_token;

	const client = new Twitter({ consumer_key, consumer_secret, access_token_key, access_token_secret });

	ctx.body = await new Promise((resolve, reject) => {
		client.post('favorites/create', { id }, (err, result, res) => {
			if (err) {
				console.log(result);
				return reject(new Error(err.data));
			}

			resolve(result);
		});
	});
}))

app.use(route.delete('/like', async (ctx, next) => {
	const { id, access_token, access_token_secret } = ctx.request.body;
	const access_token_key = access_token;

	const client = new Twitter({ consumer_key, consumer_secret, access_token_key, access_token_secret });

	ctx.body = await new Promise((resolve, reject) => {
		client.post('favorites/destroy', { id }, (err, result, res) => {
			if (err) {
				console.log(result);
				return reject(new Error(err.data));
			}

			resolve(result);
		});
	});
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
