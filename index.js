"use strict";

const fp = require("fastify-plugin");
const Express = require("express");
const kMiddlewares = Symbol("fastify-express-middlewares");

function fastifyExpress(fastify, options, next) {
  const { expressHook = "onRequest", createProxyHandler } = options;

  fastify.decorate("use", use);
  fastify[kMiddlewares] = [];
  fastify.decorate("express", Express());
  fastify.express.disable("x-powered-by");

  fastify
    .addHook(expressHook, enhanceRequest)
    .addHook(expressHook, runConnect)
    .addHook("onRegister", onRegister);

  function use(path, fn) {
    if (typeof path === "string") {
      const prefix = this.prefix;
      path = prefix + (path === "/" && prefix.length > 0 ? "" : path);
    }
    this[kMiddlewares].push([path, fn]);
    if (fn == null) {
      this.express.use(path);
    } else {
      this.express.use(path, fn);
    }
    return this;
  }

  function enhanceRequest(req, reply, next) {
    // Allow attaching custom Proxy handlers to Express req
    if (typeof createProxyHandler === "function") {
      req.raw = new Proxy(req.raw, createProxyHandler(req));
    }

    const { url } = req.raw;
    req.raw.originalUrl = url;
    req.raw.id = req.id;
    req.raw.hostname = req.hostname;
    req.raw.ip = req.ip;
    req.raw.ips = req.ips;
    req.raw.log = req.log;
    reply.raw.log = req.log;
    reply.raw.send = function send(...args) {
      // Restore req.raw.url to its original value https://github.com/fastify/fastify-express/issues/11
      req.raw.url = url;
      return reply.send.apply(reply, args);
    };

    // backward compatibility for body-parser
    if (req.body) {
      req.raw.body = req.body;
    }
    // backward compatibility for cookie-parser
    if (req.cookies) {
      req.raw.cookies = req.cookies;
    }

    // Make it lazy as it does a bit of work
    Object.defineProperty(req.raw, "protocol", {
      get() {
        return req.protocol;
      },
    });

    next();
  }

  /**
   * only run middleware on routes that have not been registered with fastify (unless opt in)
   * middleware should be run as hooks with fastify routes for compatibility with fastify.inject
   * and for performance
   * @param {import("fastify").FastifyRequest} req
   */
  function runConnect(req, reply, next) {
    const url = req.raw.url;
    const method = req.raw.method.toUpperCase();
    const hasRoute = req.server.findRoute({
      url,
      method,
    });

    if (
      this[kMiddlewares].length > 0 &&
      (!hasRoute || req.routeOptions.config.useExpressMiddleware)
    ) {
      for (const [headerName, headerValue] of Object.entries(
        reply.getHeaders(),
      )) {
        reply.raw.setHeader(headerName, headerValue);
      }

      if (req.routeOptions.url && req.routeOptions.method) {
        req.log.debug(
          `[fastify-express] running express middleware on route {url: ${url}, method: ${method}`,
        );
      }
      this.express(req.raw, reply.raw, next);
    } else {
      req.log.debug(
        `[fastify-express] skipping express middleware on route {url: ${url}, method: ${method}`,
      );
      next();
    }
  }

  function onRegister(instance) {
    const middlewares = instance[kMiddlewares].slice();
    instance[kMiddlewares] = [];
    instance.decorate("express", Express());
    instance.express.disable("x-powered-by");
    instance.decorate("use", use);
    for (const middleware of middlewares) {
      instance.use(...middleware);
    }
  }

  next();
}

module.exports = fp(fastifyExpress, {
  fastify: "4.x || 5.x",
  name: "@fastify/express",
});
module.exports.default = fastifyExpress;
module.exports.fastifyExpress = fastifyExpress;
