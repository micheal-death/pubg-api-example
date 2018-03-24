const SteamUser = require('steam-user'),
  SteamTotp = require('steam-totp'),
  fs = require('fs'),
  WebSocket = require('ws'),
  Koa = require('koa'),
  Router = require('koa-router'),
  nunjucks = require('nunjucks'),
  path = require('path')

const client = new SteamUser(),
  config = JSON.parse(fs.readFileSync('config.json')),
  app = new Koa(),
  router = new Router()

let ws, callbackList = [], count = 100000, ping

app.use(router.routes())
nunjucks.configure(path.join(__dirname, './views'), {
  autoescape: true,
})

app.listen(3000, () => {
  console.log('app now listening on port 3000')
})

router.get('/', async (ctx) => {
  ctx.body = 'hello'
})

router.get('/user/:name', getMatchData)

client.logOn({
  "accountName": config.accountName,
  "password": config.password,
  "twoFactorCode": SteamTotp.getAuthCode(config.sharedSecret),
  "rememberPassword": true
})

client.on('loggedOn', () => {
  console.log("Logged into Steam as " + client.steamID.getSteam3RenderedID())
  client.setPersona(SteamUser.EPersonaState.Online)
  client.gamesPlayed(578080, true)
  client.getAuthSessionTicket(578080, (err, ticket) => {
    console.log(ticket.toString('hex').toUpperCase())

    ws = new WebSocket(
      `wss://prod-live-entry.playbattlegrounds.com/userproxy?provider=steam&ticket=${ticket.toString('hex').toUpperCase()}&playerNetId=${config.steamId}&cc=CN&clientGameVersion=3.7.20&fullClientGameVersion=3.7.20&timezoneOffset=8`, {
        perMessageDeflate: false
      })

    ws.on('open', () => {
      ping = setInterval(() => {
        sendData(["Ping"])
      }, 10000)
    })

    ws.on('message', function incoming(res) {
      console.log(res)
      let data = JSON.parse(res)
      callbackList.forEach((callback, index, array) => {
        if (callback.id === -data[0]) {
          callback(data)
          delete array[index]
        }
      })
    })

    ws.on('close', () => {
      console.log('disconnected')
    })
  })
})

function sendData(params, callback) {
  let data = JSON.stringify([++count, null, "UserProxyApi", ...params])
  console.log(data)
  ws.send(data)
  if (callback) {
    callback.id = count
    callbackList.push(callback)
  }
}

async function getMatchData(ctx) {
  return new Promise(resolve => {
    let name = ctx.params.name,
      server = ctx.query.server || 'as',
      mode = ctx.query.mode || 'solo',
      rating = ctx.query.rating || 'Rating'
    sendData(["GetBroUserStatesByNickname", [name]], res => {
      if (res[3]['Result'].length > 0) {
        sendData(["GetBroLeaderboard", server, mode, rating, res[3]['Result'][0]['AccountId']], res => {
          try {
            let data = res[3]['Result']['User']
            if (data !== null) {
              ctx.body = nunjucks.render('index.html', data)
            } else {
              ctx.body = 'no match data'
            }
          } catch (e) {
            if (res[3] === 'NullReferenceException') {
              ctx.body = 'parameter error'
            } else {
              console.error(e)
            }
          } finally {
            resolve()
          }
        })
      } else {
        ctx.body = 'could not find the player'
        resolve()
      }
    })
  })
}