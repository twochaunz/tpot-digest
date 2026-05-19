import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const contentScriptPath = path.join(__dirname, 'content.js')
const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
try {
  const page = await browser.newPage()

  await page.setContent(`
    <!doctype html>
    <body>
      <article data-testid="tweet" id="outer">
        <div>
          <article data-testid="tweet" id="embedded">
            <div data-testid="User-Name"><a href="/embedded">embedded</a></div>
            <a href="/embedded/status/1111111111111111111">
              <time datetime="2026-05-19T10:00:00.000Z"></time>
            </a>
            <div role="group" id="embedded-actions">
              <button data-testid="bookmark" type="button">bookmark embedded</button>
            </div>
          </article>
        </div>
        <div data-testid="User-Name"><a href="/jimbelosic">Jim Belosic</a></div>
        <a href="/jimbelosic/status/2056757837951574355">
          <time datetime="2026-05-19T15:24:14.000Z"></time>
        </a>
        <div role="group" id="outer-actions">
          <button data-testid="bookmark" type="button">bookmark parent</button>
        </div>
      </article>
    </body>
  `)

  await page.evaluate(() => {
    window.__tpotMessages = []
    window.chrome = {
      runtime: {
        id: 'test-extension',
        sendMessage(message, cb) {
          window.__tpotMessages.push(message)
          if (message.type === 'SAVE_TWEET') {
            cb({ id: 42, tweet_id: message.tweet.tweet_id, status: 'saved' })
          } else if (message.type === 'GET_TOPICS') {
            cb({ topics: [] })
          } else if (message.type === 'CHECK_SAVED') {
            cb({ saved: {} })
          } else {
            cb({})
          }
        },
        lastError: null,
      },
    }
  })

  await page.addScriptTag({ path: contentScriptPath })
  await page.waitForSelector('#outer-actions .tpot-save-btn')
  await page.click('#outer-actions .tpot-save-btn')

  const saveMessage = await page.waitForFunction(() => (
    window.__tpotMessages.find((msg) => msg.type === 'SAVE_TWEET')
  )).then((handle) => handle.jsonValue())

  assert.equal(saveMessage.tweet.tweet_id, '2056757837951574355')
  assert.equal(saveMessage.tweet.saved_at, '2026-05-19T12:00:00')
} finally {
  await browser.close()
}
