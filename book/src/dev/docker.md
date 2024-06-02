## Docker

Clone the repo and make it your working directory

```shell script
git clone https://github.com/useverto/trading-post
cd trading-post
```

Build a Docker image:

```shell script
docker build -t trading-post .
```

Now run a Docker container using the image

```shell script
docker run -p 127.0.0.1:8080:8080 \
    -v /path/to/arweave.json:/app/arweave.json:ro \
    -v /path/to/privatekey:/app/privatekey:ro \
    -e ETH_ADDRESS=<your eth address> \
    -e PUBLIC_URL=your-public-url.io \
    -d trading-post
```

Your own trading post should now be up and running! 🎉

Now you can continue with [setting up a reverse proxy](./proxy.md).
