import superagent from 'superagent';
import url from 'url';
import { btoa } from 'Base64';

const SCOPES = 'history,identity,mysubreddits,read,subscribe,vote,submit,' +
               'save,edit,account,creddits,flair,livemanage,modconfig,' +
               'modcontributors,modflair,modlog,modothers,modposts,modself,' +
               'modwiki,privatemessages,report,wikiedit,wikiread';


const login = (apiOptions, username, pass) => {
  return new Promise((r, x) => {
    if (!apiOptions.oauthAppOrigin) {
      x('Please set up a Reddit Oauth App, and pass in its URL as oauthAppOrigin to config.');
    }

    if (!apiOptions.clientId) {
      x('Please set up a Reddit Oauth App, and pass in its id as clientId to config.');
    }

    if (!apiOptions.clientSecret) {
      x('Please set up a Reddit Oauth App, and pass in its secret as clientSecret to config.');
    }

    superagent
      .post(`${apiOptions.origin}/api/login/${username}`)
      .type('form')
      .send({ user: username, passwd: pass, api_type: 'json' })
      .end((err, res) => {
        if (err || !res.ok) {
          return x(err || res);
        }

        // the error response for login is different than most of the rest of
        // the api
        if (res.body.json && res.body.json.errors && res.body.json.errors.length) {
          return x(res.body.json.errors);
        }

        const cookies = (res.header['set-cookie'] || []).map(c => {
          return c.split(';')[0];
        });

        if (res.header['set-cookie'].join('').indexOf('reddit_session')) {
          return convertCookiesToAuthToken(apiOptions, cookies).then(r,x);
        }

        x('Invalid login information.');
      });
  });
};

const refreshToken = (apiOptions, refreshToken) => {
  return new Promise((resolve, reject) => {
    const endpoint = `${apiOptions.origin}/api/v1/access_token`;
    const s = btoa(
      `${apiOptions.clientId}:${apiOptions.clientSecret}`
    );

    const basicAuth = `Basic ${s}`;

    const data = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    };

    const headers = {
      'User-Agent': apiOptions.userAgent,
      'Authorization': basicAuth,
      ...apiOptions.defaultHeaders,
    };

    superagent
      .post(endpoint)
      .set(headers)
      .type('form')
      .send(data)
      .end((err, res) => {
        if (err || !res.ok) {
          if (err.timeout) { err.status = 504; }
          return reject(err || res);
        }

        /* temporary while api returns a `200` with an error in body */
        if (res.body.error) {
          return reject(401);
        }

        return resolve(res.body);
      });
  });
}

const convertCookiesToAuthToken = (apiOptions, cookies) => {
  return new Promise((resolve, reject) => {
    if (!cookies) { reject('No cookies passed in'); }

    const endpoint = `${apiOptions.origin}/api/me.json`;

    const headers = {
      'User-Agent': apiOptions.userAgent,
      cookie: cookies.join('; '),
      ...apiOptions.defaultHeaders,
    };

    superagent
      .get(endpoint)
      .set(headers)
      .end((err, res) => {
        if (err || !res.ok) {
          if (err.timeout) { err.status = 504; }
          return reject(err || res);
        }

        if (res.body.error || !res.body.data) {
          return reject(401);
        }

        const modhash = res.body.data.modhash;
        const endpoint = `${apiOptions.origin}/api/v1/authorize`;

        const redirect_uri = `${apiOptions.oauthAppOrigin}/oauth2/token`;

        const clientId = apiOptions.clientId;
        const clientSecret = apiOptions.clientSecret;

        const postParams = {
          client_id: clientId,
          redirect_uri,
          scope: SCOPES,
          state: modhash,
          duration: 'permanent',
          authorize: 'yes',
        };

        headers['x-modhash'] = modhash;

        superagent
          .post(endpoint)
          .set(headers)
          .type('form')
          .send(postParams)
          .redirects(0)
          .end((err, res) => {
            if (res.status !== 302) {
              return resolve(res.status || 500);
            }

            if (res.body.error) {
              return resolve(401);
            }

            const location = url.parse(res.headers.location, true);
            const code = location.query.code;

            const endpoint = `${apiOptions.origin}/api/v1/access_token`;

            const postData = {
              grant_type: 'authorization_code',
              code,
              redirect_uri,
            };

            const s = btoa(
              `${clientId}:${clientSecret}`
            );

            const basicAuth = `Basic ${s}`;

            const headers = {
              'User-Agent': apiOptions.userAgent,
              'Authorization': basicAuth,
              ...apiOptions.defaultHeaders,
            };

            superagent
              .post(endpoint)
              .set(headers)
              .send(postData)
              .type('form')
              .end(function(err, res) {
                if (err || !res.ok) {
                  if (err.timeout) { err.status = 504; }
                  reject(err);
                }

                return resolve(res.body);
              });
          });
      });
  });
}

export default {
  login,
  refreshToken,
  convertCookiesToAuthToken,
};
