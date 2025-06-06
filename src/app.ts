import Koa, { HttpError } from "koa"
import CORS from "kcors"
import url from "url"

import { Config } from "./config"
import router from "./router"

const ErrorMiddleware = () => async (ctx: Koa.Context, next: () => Promise<any>) => {
  try {
    return await next()
  } catch (error) {
    if (error instanceof HttpError && error.status && error.status >= 400 && error.status < 500) {
      const body: any = {
        error: error?.message || "Unknown error"
      }
      for (const prop of ["data", "response"]) {
        if (prop in error) {
          body[prop] = error[prop]
        }
      }
      ctx.response.body = body
      ctx.response.status = error.status
    } else {
      // re-throw
      throw error
    }
  }
}

export default function createApp(config: Config) {
  const app = new Koa()
  const pathPrefix = url.parse(config.baseUrl).pathname as string

  router.prefix(pathPrefix)

  return app
    .use(CORS())
    .use(ErrorMiddleware())
    .use(router.routes())
    .use(router.allowedMethods())
}
