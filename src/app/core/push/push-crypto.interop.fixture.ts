// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * NC push crypto interop fixture.
 *
 * Generated with the same primitives as `OCA\Notifications\Push::encryptAndSign`:
 * `openssl_public_encrypt(..., OPENSSL_PKCS1_PADDING)` + `openssl_sign(..., OPENSSL_ALGO_SHA512)`
 * over the raw encrypted bytes (not the decrypted JSON).
 *
 * Plain JSON matches a typical `notification:test-push --talk` payload shape.
 */
export const NC_PUSH_INTEROP_FIXTURE = {
  devicePrivateKeyPem: `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQCugvdr2UPX7xOJ
7dJuHv/JnFtR+3zL0vwuar5fg33XcF800kJYv+PiUOG89amCEdxMwrYkCkSEfZay
t5LvjPIo6GIeXK9jmazfUHmvqp8EPsZ/1HGjMbXP1ZQBfI4bnYnLaozf95gYSUvf
RE02o0OVr+lgtvbsx+DfukD3s90FbsonsDHGsnupEzaI9friJZF2x3enD/1Qqoij
PYahzHc8Uy/3D5dBdSLNaeCbPm4O2emgxctYVjZWInl8QqWpcrgeCOZLsaN7x10J
HfwrbWBjGo+6LcrNNgZRLRQIM1qZ+0hhoFTVdazE+2LGg/aBBPDWvMAfXR3c12vz
G2XVYl59AgMBAAECggEAHR52WZUZyHS4nmnEFKLwjHweEspzcvFEKhyeooJm46V5
BW/WKUfvpwpW+HhHbhA74cUVrmLWNwNbu3t9NaKfn6rTAHz3uRdh7KtZerHuMb+l
0Juq0I/RZhodxbe6YKpDXWFsm0yNoPPOCLW1apoIg3gkaYJuJmldwQcrowlspmSl
B6DLRXRtUnbhqgfErOpLLmLKbEeJdt9ZF7hqqc1+DhVBxhhCh+ZGY+7n4anJoU9K
QRrjcuMPDEEi34p4yvR+3W4TpsY0iq8v8BzP3MdxDMg+2u15AO3qeJg43BaO4xrY
lmaY4LcqTvOMzGbFC8iSCzt0QMSo5YDv09c7cRepQwKBgQDgA4kl95bMXyk826Bo
TXft3cGdxq4eej9ri/Ax3EmU+CQiL99AOoMpfjc3x0G4NBrL8mvcN4A6TymoJSzI
DiBC8J6yAjfyt3YB6icb2Gkvf1fK4oG+eOddN3NXtZn0X3ee2G+e3h94qGpuSqQI
4gW2voViyXq9QLCJh2mMoyi5MwKBgQDHbfTnfom6hy9TC/uCb28G2hdyuvxb6FfZ
GFf2RZ5q1qcghXDp2dO1rErhp3sVFYTqzUjF95BaXLfsF/nHDYtfI32J+5f5wwZe
8QQafuEscsD8jeBHCD0GALgZFtXeMHRKAXFu09ud1xC1jxe9JkHYF+B6jsLLHyJ8
wZumLZ9pjwKBgArpISzwOjAKEoAcUlvCKi0zt9JvctuZKK2cSz6idBMFYv0nR8Bh
GTJUK2xUECdgok18qTQ4n843PNgrt1qnFXstLQ2OfhscRGsjdHQuvjDKCwSes6ML
UHmB0eRbu/vjCnh6IjWiq/W8fjKRABxOpeiYrvZ4ybmeBPst1T48VCdxAoGARm71
MdUk+3XHJwNyXozQn5Di+yhC/IrAi/HnDxlja8RH3lqCmHTQKreg8rVd6QJioTLD
YveeSeu5IW8OTljgQkecjOEIubNBSsLAekMZb8NPmWLaNPwZ4UbbvjCsc/6U85Yy
47t7MvHD+vuAnNMoKhO0ulQ1Q9vJKFqQiE5QoM0CgYAO2GYx+UUKpkRG0U9DtI2Q
eyfEcdCdITa7g3YASq/bfqGT9EKwh54Cby5U9Dt5MK+TDaXvG8jysJ793CMRW9+S
+zqS6RhTvGnLQSjDrpfy+sWRu1VsM2obw9z1nr6v0a57NySG/se8YmjvKqzJfbHa
Y0z7nR33ONdTmy8zpWjzTQ==
-----END PRIVATE KEY-----`,
  devicePublicKeyPem: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAroL3a9lD1+8Tie3Sbh7/
yZxbUft8y9L8Lmq+X4N913BfNNJCWL/j4lDhvPWpghHcTMK2JApEhH2WsreS74zy
KOhiHlyvY5ms31B5r6qfBD7Gf9RxozG1z9WUAXyOG52Jy2qM3/eYGElL30RNNqND
la/pYLb27Mfg37pA97PdBW7KJ7AxxrJ7qRM2iPX64iWRdsd3pw/9UKqIoz2Gocx3
PFMv9w+XQXUizWngmz5uDtnpoMXLWFY2ViJ5fEKlqXK4HgjmS7Gje8ddCR38K21g
YxqPui3KzTYGUS0UCDNamftIYaBU1XWsxPtixoP2gQTw1rzAH10d3Ndr8xtl1WJe
fQIDAQAB
-----END PUBLIC KEY-----`,
  userPublicKeyPem: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnK64H6ySPdikBT6759Gc
HK7CMersHKPRSsAan4NcTwXVjeVHkyZVHH/4USDLMnfpjWuv0PcvmiNMhFijgPrq
c03EV/WuhQh7ZrzSyPl6rGn6OemoWU5qyVsWdgD6q68VONSSlK8/2TzEz3BuL/k2
xVQfjUHZkGsq47knGABNUzeJMYxWsbF38sNUwS1MuCHwgJiHPrUH76qFvaNoD88y
zawl9m8NAHqIG4cSq0h2vQxTAH7k39ge/CTZmnyp45rcTtK6uRX8ixgyI+uy008y
+1ow2NN/7wt5NYI6p5BS6u3/0l8q+kb+bZtNXsx50ZMh47vHPNFjEyJ0wCtFf+ay
sQIDAQAB
-----END PUBLIC KEY-----`,
  encryptedSubjectBase64:
    'fZceETUAQvv4YcbUVFw12HkuJmx1ILCqfxSzVvKQVYFNwkrKTfRbQN0CIMVNP2F7SzqEf84lMbp9HCu4UaaheUPQwKWDEYlO7JoKePCBRYEzGjROgWfs74tj28BE9SnBAU3LuZMMrQyByewjlM4V21g4bcAhYEOSEoZlcI7dUuSqV6/c9+NCjMqmpEDSrPuR0uo/v2Y+3PSq/WAXebBbK3XCd/6gSQonkWTAeqXJTyBRRAi/s9EtvY5C7/nCDTdhXw/eEltsNaqGVyn2E/ksryjq/QhkeHbQ4DKFnPVnN5IRvmMDHYVR+c6knZIw/VR/v9J3bl1lmMOcKkYdiCdTTQ==',
  signatureBase64:
    'SE9eVU54wh/ab5vQLY5zSynWvyZXqRNxJEiAYlWMg1WuTVjPQV5Xcr7omnwfSigXbJf9jj1+GyqAu1qGO7uDLbKFZP+Rg5LKunIXL+s8452afTQl8KtTJUlD2VuEPts0da1GRI0+XeQt0Hs4yhJUCbu6neYYP5OkOU4wEngMPLSk/SZn+YzdY2vGB5qJv5lUR/+jGd8jpmAmaf/srY4vQ9Z0LVtXLjFYwkpydS9eQNfoKX/sbQ3VJ5bd/M8XUGPJ6p903k4utlhJ0eE+8rJsYDyfGXGhUjOHR0+yazUD/72gWf/4ynAlPDF3h7Jc/SxmJKjIa9qmBieFoLJ8AGPLZA==',
  plainJson:
    '{"nid":525210,"app":"spreed","subject":"Testing push notifications","type":"chat","id":"614aeee4"}',
} as const;
