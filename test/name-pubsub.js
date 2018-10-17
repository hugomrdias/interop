/* eslint-env mocha */
'use strict'

const chai = require('chai')
const dirtyChai = require('dirty-chai')
const expect = chai.expect
chai.use(dirtyChai)

const { fromB58String } = require('multihashes')

const parallel = require('async/parallel')
const retry = require('async/retry')
const series = require('async/series')

const IPFS = require('ipfs')
const DaemonFactory = require('ipfsd-ctl')

const waitFor = require('./utils/wait-for')

const config = {
  Addresses: {
    API: '/ip4/0.0.0.0/tcp/0',
    Gateway: '/ip4/0.0.0.0/tcp/0',
    Swarm: ['/ip4/0.0.0.0/tcp/0', '/ip4/0.0.0.0/tcp/0/ws']
  }
}

const spawnJsDaemon = (callback) => {
  // DaemonFactory.create({ type: 'js' })
  DaemonFactory.create({ type: 'proc', exec: IPFS })
    .spawn({
      disposable: true,
      initOptions: { bits: 512 },
      args: ['--enable-namesys-pubsub'],
      config
    }, callback)
}

const spawnGoDaemon = (callback) => {
  DaemonFactory.create()
    .spawn({
      disposable: true,
      initOptions: { bits: 1024 },
      args: ['--enable-namesys-pubsub'],
      config
    }, callback)
}

const ipfsRef = '/ipfs/QmPFVLPmp9zv5Z5KUqLhe2EivAGccQW2r7M7jhVJGLZoZU'

describe.only('name-pubsub', () => {
  describe('js nodes', () => {
    let ipfsA
    let ipfsB
    let nodeAId
    let nodeBId
    let aMultiaddr
    let bMultiaddr
    let nodes = []

    // Spawn daemons
    before(function (done) {
      // CI takes longer to instantiate the daemon, so we need to increase the
      // timeout for the before step
      this.timeout(80 * 1000)

      series([
        (cb) => {
          spawnJsDaemon((err, node) => {
            expect(err).to.not.exist()
            ipfsA = node.api
            nodes.push(node)
            cb()
          })
        },
        (cb) => {
          spawnJsDaemon((err, node) => {
            expect(err).to.not.exist()
            ipfsB = node.api
            nodes.push(node)
            cb()
          })
        }
      ], done)
    })

    // Get node ids
    before(function (done) {
      parallel([
        (cb) => {
          ipfsA.id((err, res) => {
            expect(err).to.not.exist()
            expect(res.id).to.exist()
            nodeAId = res
            aMultiaddr = res.addresses[0]
            cb()
          })
        },
        (cb) => {
          ipfsB.id((err, res) => {
            expect(err).to.not.exist()
            expect(res.id).to.exist()
            nodeBId = res
            bMultiaddr = res.addresses[0]
            cb()
          })
        }
      ], done)
    })

    // Connect
    before(function (done) {
      this.timeout(60 * 1000)
      ipfsB.swarm.connect(aMultiaddr, done)
    })

    after(function (done) {
      this.timeout(60 * 1000)
      parallel(nodes.map((node) => (cb) => node.stop(cb)), done)
    })

    it('should get enabled state of pubsub', function (done) {
      ipfsA.name.pubsub.state((err, state) => {
        expect(err).to.not.exist()
        expect(state).to.exist()
        expect(state.enabled).to.equal(true)

        done() // TODO ipfsB
      })
    })

    it('should publish the received record to a js node subscriber', function (done) {
      this.timeout(300 * 1000)
      const topic = `/ipns/${fromB58String(nodeAId.id).toString()}`
      let subscribed = false

      ipfsB.name.resolve(nodeAId.id, (err) => {
        expect(err).to.exist()

        function checkMessage(msg) {
          subscribed = true
        }

        series([
          (cb) => waitForPeerToSubscribe(topic, nodeBId, ipfsA, cb),
          (cb) => ipfsB.pubsub.subscribe(topic, checkMessage, cb),
          (cb) => ipfsA.name.publish(ipfsRef, { resolve: false }, cb),
          (cb) => ipfsA.name.resolve(nodeAId.id, cb),
          (cb) => waitFor(() => subscribed === true, cb),
          (cb) => ipfsB.name.resolve(nodeAId.id, cb)
        ], (err, res) => {
          expect(err).to.not.exist()
          expect(res).to.exist()

          expect(res[2].name).to.equal(nodeAId.id) // Published to Node A ID
          expect(res[3].path).to.equal(ipfsRef)
          expect(res[5].path).to.equal(ipfsRef)
          done()
        })
      })
    })
  })

  describe.only('bybrid nodes', () => {
    let ipfsA
    let ipfsB
    let nodeAId
    let nodeBId
    let aMultiaddr
    let bMultiaddr
    let nodes = []

    // Spawn daemons
    before(function (done) {
      // CI takes longer to instantiate the daemon, so we need to increase the
      // timeout for the before step
      this.timeout(80 * 1000)

      series([
        (cb) => {
          spawnGoDaemon((err, node) => {
            expect(err).to.not.exist()
            ipfsA = node.api
            nodes.push(node)
            cb()
          })
        },
        (cb) => {
          spawnJsDaemon((err, node) => {
            expect(err).to.not.exist()
            ipfsB = node.api
            nodes.push(node)
            cb()
          })
        }
      ], done)
    })

    // Get node ids
    before(function (done) {
      parallel([
        (cb) => {
          ipfsA.id((err, res) => {
            expect(err).to.not.exist()
            expect(res.id).to.exist()
            nodeAId = res
            aMultiaddr = res.addresses[0]
            cb()
          })
        },
        (cb) => {
          ipfsB.id((err, res) => {
            expect(err).to.not.exist()
            expect(res.id).to.exist()
            nodeBId = res
            bMultiaddr = res.addresses[0]
            cb()
          })
        }
      ], done)
    })

    // Connect
    before(function (done) {
      this.timeout(60 * 1000)
      ipfsB.swarm.connect(aMultiaddr, done)
    })

    after(function (done) {
      this.timeout(60 * 1000)
      parallel(nodes.map((node) => (cb) => node.stop(cb)), done)
    })

    it('should get enabled state of pubsub', function (done) {
      ipfsA.name.pubsub.state((err, state) => {
        expect(err).to.not.exist()
        expect(state).to.exist()
        expect(state.enabled).to.equal(true)

        done() // TODO ipfsB
      })
    })

    it('should publish the received record to a go node and a js subscriber should receive it', function (done) {
      this.timeout(250 * 1000)
      const topic = `/ipns/${fromB58String(nodeAId.id).toString()}`
      let subscribed = false

      ipfsB.name.resolve(nodeAId.id, (err) => {
        expect(err).to.exist()

        function checkMessage(msg) {
          console.log('msg received')
          subscribed = true
        }

        series([
          (cb) => waitForPeerToSubscribe(topic, nodeBId, ipfsA, cb),
          (cb) => ipfsB.pubsub.subscribe(topic, checkMessage, cb),
          (cb) => ipfsA.name.publish(ipfsRef, { resolve: false }, cb),
          (cb) => ipfsA.name.resolve(nodeAId.id, cb),
          (cb) => waitFor(() => subscribed === true, 50 * 1000, cb),
          (cb) => ipfsB.name.resolve(nodeAId.id, cb)
        ], (err, res) => {
          console.log('res', res)
          console.log('err', err)
          expect(err).to.not.exist()
          expect(res).to.exist()

          expect(res[2].name).to.equal(nodeAId.id) // Published to Node A ID
          expect(res[3].path).to.equal(ipfsRef)
          expect(res[5].path).to.equal(ipfsRef)
          done()
        })
      })
    })

    it.only('should publish the received record to a js node and a go subscriber should receive it', function (done) {
      this.timeout(350 * 1000)
      const topic = `/ipns/${fromB58String(nodeBId.id).toString()}`
      let subscribed = false

      ipfsA.name.resolve(nodeBId.id, (err, res) => {
        console.log('res', res)
        console.log('err', err)
        expect(err).to.exist()

        function checkMessage(msg) {
          console.log('msg received')
          subscribed = true
        }

        series([
          (cb) => waitForPeerToSubscribe(topic, nodeAId, ipfsB, cb),
          // (cb) => ipfsA.pubsub.subscribe(topic, checkMessage, cb),
          (cb) => ipfsB.name.publish(ipfsRef, { resolve: false }, cb),
          (cb) => setTimeout(cb, 30000),
          (cb) => ipfsB.name.resolve(nodeBId.id, cb),
          // (cb) => waitFor(() => subscribed === true, 50 * 1000, cb),
          (cb) => ipfsA.name.resolve(nodeBId.id, cb)
        ], (err, res) => {
          console.log('res', res)
          console.log('err', err)
          expect(err).to.not.exist()
          expect(res).to.exist()

          expect(res[2].name).to.equal(nodeBId.id) // Published to Node A ID
          expect(res[3]).to.equal(ipfsRef)
          expect(res[5]).to.equal(ipfsRef)
          done()
        })
      })
    })
  })
})



// Wait until a peer subscribes a topic
const waitForPeerToSubscribe = (topic, peer, daemon, callback) => {
  retry({
    times: 5,
    interval: 2000
  }, (next) => {
    daemon.pubsub.peers(topic, (error, peers) => {
      if (error) {
        return next(error)
      }

      if (!peers.includes(peer.id)) {
        return next(new Error(`Could not find peer ${peer.id}`))
      }
      console.log('in')

      return next()
    })
  }, callback)
}

// Wait until a peer subscribes a topic
const waitForPeerToSubscribe2 = (topic, peer, daemon, callback) => {
  retry({
    times: 5,
    interval: 2000
  }, (next) => {
    daemon.name.pubsub.subs((error, res) => {
      console.log('err', error)
      console.log('res', res)
      if (error) {
        return next(error)
      }

      if (!res.strings || !res.strings.length) {
        return next(new Error('Could not find subscription'))
      }

      return next()
    })
  }, callback)
}
