FROM node:15-alpine
RUN mkdir /app
COPY . /app/
COPY verto.config.example.json /app/verto.config.json
WORKDIR /app
RUN yarn && yarn prod
CMD [ "node", "/app/dist/verto.js" ]
EXPOSE 8080/tcp