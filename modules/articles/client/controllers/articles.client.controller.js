'use strict';

// Articles controller
angular.module('articles').controller('ArticlesController', ['$resource', '$scope', '$stateParams', '$location', 'Authentication', 'Articles', 'ArticlesService2',
  function ($resource, $scope, $stateParams, $location, Authentication, Articles, ArticlesService2) {
    $scope.authentication = Authentication;
    
    $scope.chageStateRepository = function (article) {
      $scope.article = ArticlesService2.query({
        param1: article._id,
      });
      article.active = !article.active;
    };
    // Create new Article
    $scope.create = function (isValid) {
      $scope.error = null;

      if (!isValid) {
        $scope.$broadcast('show-errors-check-validity', 'articleForm');

        return false;
      }

      // Create new Article object
      var article = new Articles({
        title: this.title,
        content: this.content
      });

      // Redirect after save
      article.$save(function (response) {
        $location.path('articles/' + response._id);

        // Clear form fields
        $scope.title = '';
        $scope.content = '';
      }, function (errorResponse) {
        $scope.error = errorResponse.data.message;
      });
    };

    // Remove existing Article
    $scope.remove = function (article) {
      if (article) {
        article.$remove();

        for (var i in $scope.articles) {
          if ($scope.articles[i] === article) {
            $scope.articles.splice(i, 1);
          }
        }
      } else {
        $scope.article.$remove(function () {
          $location.path('articles');
        });
      }
    };

    // Update existing Article
    $scope.update = function (isValid) {
      $scope.error = null;

      if (!isValid) {
        $scope.$broadcast('show-errors-check-validity', 'articleForm');

        return false;
      }

      var article = $scope.article;

      article.$update(function () {
        $location.path('articles/' + article._id);
      }, function (errorResponse) {
        $scope.error = errorResponse.data.message;
      });
    };

    // Find a list of Articles for user
    $scope.find = function () {
      $scope.articles = Articles.query();
      //$scope.articles = Articles.get({user: userData});
    };

    // Find existing Article
    $scope.findOne = function () {
      $scope.article = Articles.get({
        articleId: $stateParams.articleId
      });
    };
    $scope.hasCommit = function (article) {
      return article !== null && article !== undefined;
    };
  }
]);
