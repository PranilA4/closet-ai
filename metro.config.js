const http = require('node:http');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const defaultEnhanceMiddleware = config.server.enhanceMiddleware;

config.server.enhanceMiddleware = (middleware, server) => {
  const enhanced = defaultEnhanceMiddleware
    ? defaultEnhanceMiddleware(middleware, server)
    : middleware;

  return (request, response, next) => {
    const proxyPrefix = '/closet-api';
    if (!request.url?.startsWith(proxyPrefix)) {
      return enhanced(request, response, next);
    }

    const upstream = http.request({
      hostname: '127.0.0.1',
      port: Number(process.env.PORT || 8787),
      method: request.method,
      path: request.url.slice(proxyPrefix.length) || '/',
      headers: { ...request.headers, host: `127.0.0.1:${process.env.PORT || 8787}` },
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });

    upstream.on('error', (error) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      response.writeHead(502, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: `ClosetAI API proxy unavailable: ${error.message}` }));
    });
    request.pipe(upstream);
  };
};

module.exports = config;
