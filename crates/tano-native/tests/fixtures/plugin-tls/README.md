# Local HTTPS test peer

`key.pem` is intentionally public test material. `cert.pem` is a leaf for the reserved
`connection.test` hostname, signed by `ca.pem`; it is not used by the product and the
test CA is never installed into the operating system. Certificates expire in 2036.

The Rust transport test starts `server.cjs` on a random loopback port, explicitly
trusts only this CA in its test client, and kills the owned process on completion.
Production DNS validation rejects loopback; only the test client supplies the
loopback address. This verifies TLS validation, JSON requests, response limits,
no redirects/retries/cookies, credential echo rejection and cancelled reads.

To rotate fixtures, generate a temporary self-signed root CA, then an RSA leaf CSR
with CN and SAN `connection.test`. Sign the leaf with `CA:FALSE`, key usage
`digitalSignature,keyEncipherment` and extended key usage `serverAuth`. Keep only
the public root certificate, signed leaf certificate and public test leaf key here;
the temporary root private key is not needed for running tests.
