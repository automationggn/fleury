const { app } = require('@azure/functions');

const enroll = require('./functions/enroll');
const verify = require('./functions/verify');

app.http('enroll', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: enroll
});

app.http('verify', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: verify
});