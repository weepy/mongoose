var EventEmitter = require('events').EventEmitter,
    Class = require('./util').Class,
    object = require('./util').object,
    query = require('./query'),
    
Model = this.Model = Class({
  
  include: [EventEmitter.prototype],
  
  extend: {
    find: function(where, hydrate){
      if (arguments.length == 3) throw new Error('Subsets are not implemented yet.');
      var _where = where || {}, self = this,
      _writer = new query.Writer(function(query, options, promise){
        self._collection.find(query, options, function(err, cursor){
          if (err) return self._connection._error(err);
          cursor.toArray(function(err, results){
            if (err) return self._connection._error(err);
            if (hydrate !== false){
              results.forEach(function(doc, i){
                results[i] = new self(doc,true);
              });
            }
            promise.complete(results);
          });
        });
      });
      for (var i in _where) _writer.where(i, _where[i]);
      return _writer;
    },
    
    remove: function(where, fn){
      this._collection.remove(where, function(err){
        if (err) return self._connection._error(err);
        fn();
      });
      return this;
    },
    
    count: function(where, fn){
      this._collection.count(where, function(err, count){
        if (err) return self._connection._error(err);
        fn(count);
      });
      return this;
    }
  },
  
  init: function(doc,hydrate){
    this._schema();
    Object.defineProperty(this,'isNew',{value: !!!hydrate, enumerable: false});
    Object.defineProperty(this,'_dirty',{value: {}, enumerable: false});
    Object.defineProperty(this,'__doc',{value: object.mixin(true, this.__doc, doc), enumerable: false});
  },
  
  _error: function(err){
    this.emit('error', err);
  },
  
  _set: function(path, value){
    var parts = path.split('.'), doc = this.__doc;
    for (var i = 0, l = parts.length; i < l; i++){
      if (i + 1 == l){
        if (doc[parts[i]] !== value){
          // do casting here ?
          this._dirty[path] = true;
          doc[parts[i]] = value;
        }
      } else {
        doc = doc[parts[i]];
      }
    }
    return this;
  },
  
  _get: function(path){
    var parts = path.split('.'), doc = this.__doc;
    for (var i = 0, l = parts.length; i < l; i++){
      doc = doc[parts[i]];
      if (typeof doc == 'undefined') throw new Error('Path ' + path + ' is undefined');
    }
    return doc;
  },
  
  isDirty: function(n){
    if (typeof n == 'string') return n in this._dirty;
    return !!Object.keys(this._dirty).length;
  },
  
  toObject: function(){
    return this.__doc;
  },
  
  save: function(fn){
    var self = this;
    this._collection.save(this.__doc, function(){
      self.isNew = false;
      if(fn) fn();
    });
    return this;
  },
  
  remove: function(fn){
    if (this.isNew){
      if (fn) fn();
      return this;
    }
    this._collection.remove({ _id: this.__doc._id }, fn);
    return this;
  }
  
});

(function(){

  Model.compile = function(name, model, connection){
    var _model = object.mixin(true, {}, model),
        _definition = _model.methods || {}, _collection = _model.collection || (name.toLowerCase() + 's'),
        _props = _model.properties, setters = _model.setters || {}, getters = _model.getters || {};
    _definition.extend = _model['static'] || {};

    var doc = _compileProperties(_props);
    doc._id = null;
    _model = Model.extend(_definition);
    _model._connection = connection;
    _model._collection = connection.collection(_collection);
    Object.defineProperty(_model.prototype,'_connection',{value: _model._connection, enumerable: false});
    Object.defineProperty(_model.prototype,'_collection',{value: _model._collection, enumerable: false});
    Object.defineProperty(_model.prototype,'__doc',{value: _compileProperties(_props), enumerable: false});
    _model.prototype.__doc._id = null;
    Object.defineProperty(_model.prototype,'_schema',{value: new Function('this.__doc = ' + JSON.stringify(doc)), enumerable: false });
    _compileEtters(doc, getters, setters, _model.prototype);
    return _model;
  };

  var _compileProperties = function(props){

    var _props = props || [], _ret = {}, prop, field;
    
    for(i=0,l=_props.length; i<l; i++){
      prop = _props[i];
      if(Object.prototype.toString.call(prop) == '[object Object]'){
        for(field in prop){
          if(prop[field] instanceof Array){
            if(!prop[field].length) _ret[field] = [];
            else if(prop[field][0] instanceof Array){
              if(!prop[field][0].length) _ret[field] = [];
              else throw new Error('Embedded Document Array is not yet implemented');
            }
            else _ret[field] = _compileProperties(prop[field]);   
          }
        }
      } else _ret[prop] = null;
    }
    return _ret;
  },

  _compileEtters = function(props, getters, setters, prototype, path){
    for (var i in props){
      var p = (path ? path + '.' : '') + i;
      (function(props, getters, setters, p, i){
        if (props[i] == null || props[i] instanceof Array){
          prototype.__defineGetter__(i, function(){
            return getters[i] ? getters[i].apply(this, [this._get(p)]) : this._get(p);
          });
          prototype.__defineSetter__(i, function(v){
            this._set(p, setters[i] ? setters[i].apply(this, [v]) : v);
          });
        } else {
          if (!('__getters__' in prototype)) Object.defineProperty(prototype,'__getters__',{value:{}, enumerable:false});
          prototype.__defineGetter__(i, function(){
            if (!(p in this.__getters__)){
              var nested = function(){};
              nested.prototype = this;
              _compileEtters(props[i], getters[i] || {}, setters[i] || {}, nested.prototype, p);
              this.__getters__[p] = new nested();
            }
            return this.__getters__[p];
          });
        }
      })(props, getters, setters, p, i);
    }
    
    for (var i in getters){
      if (prototype.__lookupGetter__(i)) continue;
      if (typeof getters[i] !== 'function') throw new 'Virtual getter namespaces are not supported';
      (function(i){
        Object.defineProperty(prototype,i,{get: function(){ return getters[i].apply(this); }, enumerable: false});
      })(i, getters);
    }
    for (var i in setters){
      if (prototype.__lookupSetter__(i) || typeof setters[i] !== 'function') continue;
      (function(i){
        Object.defineProperty(prototype,i,{set: function(){ return setters[i].apply(this); }, enumerable: false});
      })(i, setters);
    }
  };
  
})();