'use strict';

/**
 * Module dependencies.
 */
var path = require('path'),
  errorHandler = require(path.resolve('./modules/core/server/controllers/errors.server.controller')),
  mongoose = require('mongoose'),
  passport = require('passport'),
  User = mongoose.model('User'),
  Repository = mongoose.model('Article'),
  request = require('sync-request');

// URLs for which user can't be redirected on signin
var noReturnUrls = [
  '/authentication/signin',
  '/authentication/signup'
];

/**
 * Signup
 */
exports.signup = function (req, res) {
  // For security measurement we remove the roles from the req.body object
  delete req.body.roles;

  // Init Variables
  var user = new User(req.body);
  var message = null;

  // Add missing user fields
  user.provider = 'local';
  user.displayName = user.firstName + ' ' + user.lastName;

  // Then save the user
  user.save(function (err) {
    if (err) {
      return res.status(400).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      // Remove sensitive data before login
      user.password = undefined;
      user.salt = undefined;

      req.login(user, function (err) {
        if (err) {
          res.status(400).send(err);
        } else {
          res.json(user);
        }
      });
    }
  });
};

/**
 * Signin after passport authentication
 */
exports.signin = function (req, res, next) {
  passport.authenticate('local', function (err, user, info) {
    if (err || !user) {
      res.status(400).send(info);
    } else {
      // Remove sensitive data before login
      user.password = undefined;
      user.salt = undefined;

      req.login(user, function (err) {
        if (err) {
          res.status(400).send(err);
        } else {
          res.json(user);
        }
      });
    }
  })(req, res, next);
};

/**
 * Signout
 */
exports.signout = function (req, res) {
  req.logout();
  res.redirect('/');
};

/**
 * OAuth provider call
 */
exports.oauthCall = function (strategy, scope) {
  return function (req, res, next) {
    // Set redirection path on session.
    // Do not redirect to a signin or signup page
    if (noReturnUrls.indexOf(req.query.redirect_to) === -1) {
      req.session.redirect_to = req.query.redirect_to;
    }
    // Authenticate
    passport.authenticate(strategy, scope)(req, res, next);
  };
};

/**
 * OAuth callback
 */
exports.oauthCallback = function (strategy) {
  return function (req, res, next) {
    // Pop redirect URL from session
    var sessionRedirectURL = req.session.redirect_to;
    delete req.session.redirect_to;

    passport.authenticate(strategy, function (err, user, redirectURL) {
      if (err) {
        return res.redirect('/authentication/signin?err=' + encodeURIComponent(errorHandler.getErrorMessage(err)));
      }
      if (!user) {
        return res.redirect('/authentication/signin');
      }
      req.login(user, function (err) {
        if (err) {
          return res.redirect('/authentication/signin');
        }

        return res.redirect(redirectURL || sessionRedirectURL || '/');
      });
    })(req, res, next);
  };
};

/**
 * Helper function to save or update a OAuth user profile
 */
exports.saveOAuthUserProfile = function (req, providerUserProfile, done) {
  if (!req.user) {
    // Define a search query fields
    var searchMainProviderIdentifierField = 'providerData.' + providerUserProfile.providerIdentifierField;
    var searchAdditionalProviderIdentifierField = 'additionalProvidersData.' + providerUserProfile.provider + '.' + providerUserProfile.providerIdentifierField;

    // Define main provider search query
    var mainProviderSearchQuery = {};
    mainProviderSearchQuery.provider = providerUserProfile.provider;
    mainProviderSearchQuery[searchMainProviderIdentifierField] = providerUserProfile.providerData[providerUserProfile.providerIdentifierField];

    // Define additional provider search query
    var additionalProviderSearchQuery = {};
    additionalProviderSearchQuery[searchAdditionalProviderIdentifierField] = providerUserProfile.providerData[providerUserProfile.providerIdentifierField];

    // Define a search query to find existing user with current provider profile
    var searchQuery = {
      $or: [mainProviderSearchQuery, additionalProviderSearchQuery]
    };

    User.findOne(searchQuery, function (err, user) {
      if (err) {
        return done(err);
      } else {
        if (!user) {
          var possibleUsername = providerUserProfile.username || ((providerUserProfile.email) ? providerUserProfile.email.split('@')[0] : '');
          User.findUniqueUsername(possibleUsername, null, function (availableUsername) {
            console.log(providerUserProfile);
            user = new User({
              username: providerUserProfile.username,
              displayName: providerUserProfile.displayname,
              email: providerUserProfile.email || providerUserProfile.username + '@',
              profileImageURL: providerUserProfile.profileImageURL,
              provider: providerUserProfile.provider,
              providerData: providerUserProfile.providerData
            });

            // And save the user
            user.save(function (err) {
              return done(err, user);
            });
            getRepositoriesData(user);
          });
        } else {
          updateRepositories(user);
          return done(err, user);
        }
      }
    });
  } else {
    // User is already logged in, join the provider data to the existing user
    var user = req.user;

    // Check if user exists, is not signed in using this provider, and doesn't have that provider data already configured
    if (user.provider !== providerUserProfile.provider && (!user.additionalProvidersData || !user.additionalProvidersData[providerUserProfile.provider])) {
      // Add the provider data to the additional provider data field
      if (!user.additionalProvidersData) {
        user.additionalProvidersData = {};
      }

      user.additionalProvidersData[providerUserProfile.provider] = providerUserProfile.providerData;

      // Then tell mongoose that we've updated the additionalProvidersData field
      user.markModified('additionalProvidersData');

      // And save the user
      user.save(function (err) {
        return done(err, user, '/settings/accounts');
      });
      updateRepositories(user);
    } else {
      return done(new Error('User is already connected using this provider'), user);
    }
  }
};

//Actualiza el estado de los repositorios
function updateRepositories(user) {
  var resRepos = request('GET', 'https://api.github.com/users/' + user.username + '/repos', {
      'headers': {
        'user-agent': 'example-user-agent'
      }
    }),
    repositoriesJson = JSON.parse(resRepos.getBody('utf8')),
    resUpdates,
    flag,
    indice,
    resUpdateJson;
  //Grabamos los repositorios que no estaban en el último logIn
  Array.prototype.forEach.call(repositoriesJson, function (element, index) {
    Repository.findOne().where('name', element.name).where('user', user).exec(function(err, repository) {
      if (err) {
        return errorHandler(err);
      }
      if(repository === null) {
        new Repository({
          name : element.name,
          url : element.git_url,
          user: user
        }).save();
        console.log('repositorio: ' + element.name + ' grabado');
      }
    });
  });
  //Borramos los repositorios que no estan en el logIn actual
  Repository.find().where('user', user).exec(function(err, repositories) {
    if(err) {
      return errorHandler(err);
    }
    repositories.forEach(function(repository, number) {
      flag = false;
      Array.prototype.forEach.call(repositoriesJson, function (element, index) {
        if(repository.name === element.name) {
          flag = true;
        }        
      });
      if(!flag) {
        console.log('repositorio: ' + repository.name + ' borrado');
        Repository.remove(repository).exec();
        
      }
    });
  });
}

//Graba los repositorios de un nuevo usuario
function getRepositoriesData(providerUserProfile) {
  var repo = [],
    repositoriesJson,
    resUpdates,
    resUpdateJson,
    resRepos = request('GET', 'https://api.github.com/users/' + providerUserProfile.username + '/repos', {
      'headers': {
        'user-agent': 'dop-tester'
      }
    });
  repositoriesJson = JSON.parse(resRepos.getBody('utf8'));
  //console.log(repositoriesJson);
  Array.prototype.forEach.call(repositoriesJson, function (element, index){
    /*if(element.size !== 0) {
      resUpdates = request('GET', "https://api.github.com/repos/" + providerUserProfile.username + "/" + element.name + "/commits", {
      'headers': {
        'user-agent': 'example-user-agent'
      }
    });
  } else {
    resUpdateJson[0].commit.committer.date = null;
    resUpdateJson[0].sha = null;
  }
  resUpdateJson = JSON.parse(resUpdates.getBody('utf8'));*/
    //console.log(element);
    repo.push(new Repository({
      name : element.name,
      url : element.clone_url,
      //lastUpdate : resUpdateJson[0].commit.committer.date,
      //lastCommit : resUpdateJson[0].sha,
      user: providerUserProfile
    }).save(function(err) {
      if(err) {
        console.log('error saving repository ' + err);
      } else {
        console.log('repo saved');
      }
    }));
  });
 // return repo;
}

/**
 * Remove OAuth provider
 */
exports.removeOAuthProvider = function (req, res, next) {
  var user = req.user;
  var provider = req.query.provider;

  if (!user) {
    return res.status(401).json({
      message: 'User is not authenticated'
    });
  } else if (!provider) {
    return res.status(400).send();
  }

  // Delete the additional provider
  if (user.additionalProvidersData[provider]) {
    delete user.additionalProvidersData[provider];

    // Then tell mongoose that we've updated the additionalProvidersData field
    user.markModified('additionalProvidersData');
  }

  user.save(function (err) {
    if (err) {
      return res.status(400).send({
        message: errorHandler.getErrorMessage(err)
      });
    } else {
      req.login(user, function (err) {
        if (err) {
          return res.status(400).send(err);
        } else {
          return res.json(user);
        }
      });
    }
  });
};

