var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var ejs = require('ejs-locals');
// const http = require('http');
var session = require('express-session');
var bodyParser = require('body-parser');
const { body, validationResult } = require('express-validator');
const { phoneNumberFormatter } = require('./helpers/formatter');
const knex = require('./database');
const { Client, MessageMedia } = require('whatsapp-web.js');
// const qrcode = require('qrcode-terminal');
const fs = require('fs');
const fileUpload = require('express-fileupload');
// const axios = require('axios');
var flash = require('connect-flash');
// var flash = require('express-flash');
const log4js = require('log4js');

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var loginRouter = require('./routes/login');
var listmessageRouter = require('./routes/listmessage');
var sendwaRouter = require('./routes/sendwa');
var docapiRouter = require('./routes/docapi');

var app = express();
var sessionStore = new session.MemoryStore;
app.use(session({
    store: sessionStore,
    saveUninitialized: true,
    resave: 'true',
    secret: 'secret'
}));
app.use(flash());

app.use(bodyParser.urlencoded({extended : true}));
app.use(bodyParser.json());

// default options
app.use(fileUpload());
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.engine('ejs',ejs);
app.set('view engine', 'ejs');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', loginRouter);
// Route Home
app.use('/home', indexRouter);
// Route Users
app.use('/users', usersRouter);
app.use('/users/add-users', usersRouter);
app.use('/users/data-users', usersRouter);
app.use('/users/update-users', usersRouter);
app.use('/users/delete-users', usersRouter);
app.use('/users/email-users', usersRouter);
app.use('/users/edit-users', usersRouter);
app.use('/users/reset-password', usersRouter);
// Route Login
app.use('/login', loginRouter);
app.use('/auth',loginRouter);
app.use('/logout',loginRouter);
// Route Doc Api
app.use('/docs-api', docapiRouter);
// Route List Message
app.use('/message', listmessageRouter);
app.use('/message/listMessage', listmessageRouter);
// Route Send Wa
app.use('/sendwa', sendwaRouter);
app.use('/sendwa/send-message', sendwaRouter);
app.use('/sendwa/listSender', sendwaRouter);

var sockIO = require('socket.io')();
app.sockIO = sockIO;

const sessions = [];
const SESSIONS_FILE = './whatsapp-sessions.json';
const createSessionsFileIfNotExists = function() {
  if (!fs.existsSync(SESSIONS_FILE)) {
    try {
      fs.writeFileSync(SESSIONS_FILE, JSON.stringify([]));
      console.log('Sessions file created successfully.');
    } catch(err) {
      console.log('Failed to create sessions file: ', err);
    }
  }
}
createSessionsFileIfNotExists();

const setSessionsFile = function(sessions) {
  fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions), function(err) {
    if (err) {
      console.log(err);
    }
  });
}

const getSessionsFile = function() {
  var List = JSON.parse(fs.readFileSync(SESSIONS_FILE)).filter(function (entry) {
      return entry.userid === 'admin@gmail.com';
  });
  return List;
  // return JSON.parse(fs.readFileSync(SESSIONS_FILE));
}
const createSession = function(id,userid, description) {
  console.log('Creating session: ' + id);
  const SESSION_FILE_PATH = `./public/filejson/whatsapp-session-${id}.json`;
  let sessionCfg;
  if (fs.existsSync(SESSION_FILE_PATH)) {
    sessionCfg = require(SESSION_FILE_PATH);
  }
  const client = new Client({
    restartOnAuthFail: true,
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process', // <- this one doesn't works in Windows
        '--disable-gpu'
      ],
    },
    session: sessionCfg
  });

  client.initialize();
  client.on('qr', (qr) => {
    console.log('QR RECEIVED', qr);
    var QRCode = require('qrcode')
    QRCode.toDataURL(qr, function (err, url) {
      sockIO.emit('qr', { id: id, src: url });
      sockIO.emit('message', { id: id, text: 'QR Code received, scan please!' });
    })
  });

  client.on('ready', () => {
    sockIO.emit('ready', { id: id });
    sockIO.emit('message', { id: id, text: 'Whatsapp is ready!' });
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions[sessionIndex].ready = true;
    setSessionsFile(savedSessions);
  });

  client.on('authenticated', (session) => {
    sockIO.emit('authenticated', { id: id });
    sockIO.emit('message', { id: id, text: 'Whatsapp is authenticated!' });
    sessionCfg = session;
    fs.writeFile(SESSION_FILE_PATH, JSON.stringify(session), function(err) {
      if (err) {
        console.error(err);
      }
    });
  });

  client.on('auth_failure', function(session) {
    sockIO.emit('message', { id: id, text: 'Auth failure, restarting...' });
  });

  client.on('disconnected', (reason) => {
    sockIO.emit('message', { id: id, text: 'Whatsapp is disconnected!' });
    fs.unlinkSync(SESSION_FILE_PATH, function(err) {
        if(err) return console.log(err);
        console.log('Session file deleted!');
    });
    client.destroy();
    client.initialize();

    // Menghapus pada file sessions
    const savedSessions = getSessionsFile();
    const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
    savedSessions.splice(sessionIndex, 1);
    setSessionsFile(savedSessions);
    sockIO.emit('remove-session', id);
  });

  // Tambahkan client ke sessions
  sessions.push({
    id: id,
    // userid:userid,
    userid:'admin@gmail.com',
    description: description,
    client: client
  });

  // Menambahkan session ke file
  const savedSessions = getSessionsFile();
  const sessionIndex = savedSessions.findIndex(sess => sess.id == id);
  if (sessionIndex == -1) {
    savedSessions.push({
      id: id,
      // userid:userid,
      userid:'admin@gmail.com',
      description: description,
      ready: false,
    });
    setSessionsFile(savedSessions);
  }
}
const init = function(socket) {
  const savedSessions = getSessionsFile();
  if (savedSessions.length > 0) {
    if (socket) {
      socket.emit('init', savedSessions);
    } else {
      savedSessions.forEach(sess => {
        createSession(sess.id,sess.userid, sess.description);
      });
    }
  }
}
init();

sockIO.on('connection', function(sockIO){
  init(sockIO);
  sockIO.on('create-session', function(data) {
    console.log('Create session: ' + data.id);
    createSession(data.id,data.userid, data.description);
  });
});

app.get('/log', (req, res) => {
  res.sendFile(path.join(__dirname + '/logs.log'));
});

// API Send message
app.post('/api-v1/send-message', [
  body('sender').notEmpty(),
  body('number').notEmpty(),
  body('message').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });
  if (!errors.isEmpty()) {
    return res.status(422).json({
      status: 422,
      message: errors.mapped()
    });
  }
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;
  // cek akun barcode
  if (!sessions.find(sess => sess.id == sender)) {
    return res.status(422).json({
      status: 422,
      message: 'Client Not Found Please Create Account Whats Up And Scan Barcode'
    });
  }
  const SESSION_FILE_PATHS = `./public/filejson/whatsapp-session-${sender}.json`;
  // cek kalau belum scan barcode 
  if (!fs.existsSync(SESSION_FILE_PATHS)) {
    return res.status(422).json({
      status: 422,
      message: 'Please Scan Barcode Now In App'
    });
  }
  const client = sessions.find(sess => sess.id == sender).client;
  const isRegisteredNumber = await client.isRegisteredUser(number);
  // cek kalau nomor hp terdaftar di wa
  if (!isRegisteredNumber) {
    return res.status(422).json({
      status: 422,
      message: 'The number is not registered'
    });
  }
  client.sendMessage(number, message).then(response => {
    let Datapost = [{
      sender: sender, 
      number: number,
      message: message,
      desc: 'message',
      status: 'terkirim',
    }];
      knex.transaction(function(trx) {
      knex('tbl_message').transacting(trx).insert(Datapost)
          .then()
          .then(trx.commit)
          .catch(trx.rollback);
      }).then(function(resp) {
        console.log(resp)
        res.status(200).json({
          status: 200,
          response: response
        });
      }).catch(function(err) {
        console.log(err)
        res.status(500).json({
          status: 500,
          response: err
        });
      });
  
  }).catch(err => {
    res.status(500).json({
      status: 500,
      message: err
    });
  });
});
// API Send media
app.post('/api-v1/send-media',[
  body('sender').notEmpty(),
  body('number').notEmpty(),
  body('caption').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });
  if (!errors.isEmpty()) {
    return res.status(202).json({
      status: 202,
      message: errors.mapped()
    });
  }
  if (!req.files || Object.keys(req.files).length === 0) {
    return res.status(400).json({
      status: 400,
      message: 'No files were uploaded.'
    });
  }
  const sender = req.body.sender;
  const caption = req.body.caption;
  const number = phoneNumberFormatter(req.body.number);
   // cek akun barcode
  if (!sessions.find(sess => sess.id == sender)) {
    return res.status(422).json({
      status: 422,
      message: 'Client Not Found Please Create Account Whats Up And Scan Barcode'
    });
  }
  const SESSION_FILE_PATHS = `./public/filejson/whatsapp-session-${sender}.json`;
  // cek kalau belum scan barcode 
  if (!fs.existsSync(SESSION_FILE_PATHS)) {
    return res.status(422).json({
      status: 422,
      message: 'Please Scan Barcode Now In App'
    });
  }
  const client = sessions.find(sess => sess.id == sender).client;
  const isRegisteredNumber = await client.isRegisteredUser(number);
  if (!isRegisteredNumber) {
    return res.status(201).json({
      status: 201,
      message: 'The number is not registered'
    });
  }
  const file = req.files.file;
  const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name);
  client.sendMessage(number, media, {
    caption: caption
  }).then(response => {
    let Datapost = [{
      sender: sender, 
      number: number,
      message: caption,
      desc: 'media',
      status: 'terkirim',
    }];
      knex.transaction(function(trx) {
      knex('tbl_message').transacting(trx).insert(Datapost)
          .then()
          .then(trx.commit)
          .catch(trx.rollback);
      }).then(function(resp) {
        console.log(resp)
        res.status(200).json({
          status: 200,
          response: response
        });
      }).catch(function(err) {
        console.log(err)
        res.status(500).json({
          status: 500,
          response: err
        });
      });

  }).catch(err => {
    res.status(500).json({
      status: 500,
      message: err
    });
  });
});
// Form Send message
app.post('/send-message', [
  body('sender').notEmpty(),
  body('number').notEmpty(),
  body('message').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });
  if (!errors.isEmpty()) {
    req.flash('errors',Object.values(errors.mapped()));
    res.redirect('/sendwa');
    // return res.status(422).json({
    //   status: 422,
    //   message: errors.mapped()
    // });
  }
  const sender = req.body.sender;
  const number = phoneNumberFormatter(req.body.number);
  const message = req.body.message;
  // cek akun barcode
  if (!sessions.find(sess => sess.id == sender)) {
    req.flash('errors', 'Client Not Found Please Create Account Whats Up And Scan Barcode');
    res.redirect('/sendwa');
    // return res.status(422).json({
    //   status: 422,
    //   message: 'Client Not Found Please Create Account Whats Up And Scan Barcode'
    // });
  }
  const SESSION_FILE_PATHS = `./public/filejson/whatsapp-session-${sender}.json`;
  // cek kalau belum scan barcode 
  if (!fs.existsSync(SESSION_FILE_PATHS)) {
    req.flash('errors', 'Please Scan Barcode Now In App');
    res.redirect('/sendwa');
    // return res.status(422).json({
    //   status: 422,
    //   message: 'Please Scan Barcode Now In App'
    // });
  }
  const client = sessions.find(sess => sess.id == sender).client;
  const isRegisteredNumber = await client.isRegisteredUser(number);
  // cek kalau nomor hp terdaftar di wa
  if (!isRegisteredNumber) {

    req.flash('errors', 'The number is not registered');
    res.redirect('/sendwa');

    // return res.status(422).json({
    //   status: 422,
    //   message: 'The number is not registered'
    // });
  }
  client.sendMessage(number, message).then(response => {
    let Datapost = [{
      sender: sender, 
      number: number,
      message: message,
      desc: 'message',
      status: 'terkirim',
    }];
      knex.transaction(function(trx) {
      knex('tbl_message').transacting(trx).insert(Datapost)
          .then()
          .then(trx.commit)
          .catch(trx.rollback);
      }).then(function(resp) {
        req.flash('success', 'Send Wa Successfully');
        res.redirect('/sendwa');
      }).catch(function(err) {
        console.log(err)
      });
  }).catch(err => {
    req.flash('errors', err);
    res.redirect('/sendwa');
    // res.status(500).json({
    //   status: 500,
    //   message: err
    // });
  });
});
// Form Send media
app.post('/send-media',[
  body('sender').notEmpty(),
  body('number').notEmpty(),
  body('caption').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req).formatWith(({
    msg
  }) => {
    return msg;
  });
  if (!errors.isEmpty()) {
    req.flash('errors',Object.values(errors.mapped()));
    res.redirect('/sendwa');

    // return res.status(202).json({
    //   status: 202,
    //   message: errors.mapped()
    // });
  }
  if (!req.files || Object.keys(req.files).length === 0) {

    req.flash('errors', 'No files were uploaded.');
    res.redirect('/sendwa');

    // return res.status(400).json({
    //   status: 400,
    //   message: 'No files were uploaded.'
    // });
  }
  const sender = req.body.sender;
  const caption = req.body.caption;
  const number = phoneNumberFormatter(req.body.number);
   // cek akun barcode
  if (!sessions.find(sess => sess.id == sender)) {
    req.flash('errors', 'Client Not Found Please Create Account Whats Up And Scan Barcode');
    res.redirect('/sendwa');

    // return res.status(422).json({
    //   status: 422,
    //   message: 'Client Not Found Please Create Account Whats Up And Scan Barcode'
    // });
  }
  const SESSION_FILE_PATHS = `./public/filejson/whatsapp-session-${sender}.json`;
  // cek kalau belum scan barcode 
  if (!fs.existsSync(SESSION_FILE_PATHS)) {
    req.flash('errors', 'Please Scan Barcode Now In App');
    res.redirect('/sendwa');
    // return res.status(422).json({
    //   status: 422,
    //   message: 'Please Scan Barcode Now In App'
    // });
  }
  const client = sessions.find(sess => sess.id == sender).client;
  const isRegisteredNumber = await client.isRegisteredUser(number);
  if (!isRegisteredNumber) {
    req.flash('errors', 'The number is not registered');
    res.redirect('/sendwa');
    // return res.status(201).json({
    //   status: 201,
    //   message: 'The number is not registered'
    // });
  }
  const file = req.files.file;
  const media = new MessageMedia(file.mimetype, file.data.toString('base64'), file.name);
  client.sendMessage(number, media, {
    caption: caption
  }).then(response => {
    let Datapost = [{
      sender: sender, 
      number: number,
      message: caption,
      desc: 'media',
      status: 'terkirim',
    }];
      knex.transaction(function(trx) {
      knex('tbl_message').transacting(trx).insert(Datapost)
          .then()
          .then(trx.commit)
          .catch(trx.rollback);
      }).then(function(resp) {
        console.log(resp)
        req.flash('success', 'Send Wa Media Successfully');
        res.redirect('/sendwa');
      }).catch(function(err) {
        console.log(err)
        req.flash('errors', err);
        res.redirect('/sendwa');
        // res.status(500).json({
        //   status: 500,
        //   response: err
        // });
      });

  }).catch(err => {
    req.flash('errors', err);
    res.redirect('/sendwa');
    // res.status(500).json({
    //   status: 500,
    //   message: err
    // });
  });
});

log4js.configure({
  appenders: { everything: { type: 'file', filename: 'logs.log' } },
  categories: { default: { appenders: ['everything'], level: 'ALL' } }
});
const loggers = log4js.getLogger();
loggers.debug('log message');
// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});
// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
