Exposer
=======

Exposer aims at being a webservice which aggregates all posts from various social networks in one place.

Currently, it supports collecting public Twitter and Facebook posts. You can see two instances deployed:

 * https://exposer.herokuapp.com/
 * https://aufschrei.herokuapp.com/

Remote development installation
-------------------------------

Development installation which uses remote data. Useful when developing just client side.

1. You will need `node.js`_. On Mac OS X using Homebrew_::

    brew install node

2. Clone from the GitHub_ repository::

    git clone https://github.com/mitar/exposer.git

   You can also use SSH-based URL or URL of your fork.

3. Move to location where you cloned the repository and run::

    npm install
    browserify client.js -p ./swig -o static/bundle.js

   This will install all node.js dependencies and compile client JavaScript file.

   If you want client JavaScript file to be compiled automatically on any change to source files (so that it is easy
   to develop), run with ``-w`` parameter::

    browserify client.js -w -v -p ./swig -o static/bundle.js

4. Run::

    node web.js

   and open http://127.0.0.1:5000/.

Local development installation
------------------------------

Development installation which uses local database. Useful when developing server side, too.

1. Requirement is MongoDB_ and follow its installation so
   that it runs as service in the background.

   On Mac OS X using Homebrew_::

    brew install mongodb

   Furthermore, you will need `node.js`_::

    brew install node

2. Clone from the GitHub_ repository::

    git clone https://github.com/mitar/exposer.git

   You can also use SSH-based URL or URL of your fork.

3. Move to location where you cloned the repository and run::

    npm install
    browserify client.js -p ./swig -o static/bundle.js

   This will install all node.js dependencies and compile client JavaScript file.

   If you want client JavaScript file to be compiled automatically on any change to source files (so that it is easy
   to develop), run with ``-w`` parameter::

    browserify client.js -w -v -p ./swig -o static/bundljs

4. You will need also various app keys for social networks (see ``settings.js`` file for the list). You have to
   put them into the process environment. If you are using Heroku_, you can put them into ``.env``
   file `in the root of the repository`_. You can maybe ask some other developer to provide you with the ``.env`` file.

5. Set process environment variable ``REMOTE`` to the empty string. This is necessary for Exposer to use local database.
   You can set ``MONGODB_URL`` to point to the MongoDB database if you are not running it locally with default settings.

5. Using Heroku_ you can run (which will use ``.env`` file to populate environment variables)::

    foreman start -f Procfile-development

   or (if you configure environment variables manually) simply::

    node web.js

   and open http://127.0.0.1:5000/.

.. _MongoDB: http://www.mongodb.org/
.. _Homebrew: http://mxcl.github.com/homebrew/
.. _node.js: http://nodejs.org/
.. _GitHub: https://github.com/
.. _Heroku: http://heroku.com/
.. _in the root of the repository: https://devcenter.heroku.com/articles/procfile#setting-local-environment-variables
