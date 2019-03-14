// @ts-check
/**
 * @typedef ModuleMethodParameter
 * @property {string} paramName
 * @property {*} paramValue
 * @typedef ModuleMethodError
 * @property {string} message
 * @property {boolean} isError
 */
/**
 * Get the keys of a module.
 * @param {*} module The module being wrapped.
 * @return {string[]} Array of module keys.
 */
function getModuleKeys(module) {
  return [
    ...Object.keys(module),
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(module))
  ];
}

/**
 * For web bridges, native code will run a JS script that accesses a global
 * callback related to the module's method being wrapped and pass in results so
 * that partner app can access them. This function promisifies this callback to
 * support async-await/Promise.
 * @param {*} globalObject The global object - generally window.
 * @param {string} moduleName The name of the module that owns the method.
 * @param {string} funcName The name of the method being wrapped.
 * @param {Function} funcToWrap The method being wrapped.
 * @return {Promise<unknown>} Promise that handles the callback.
 */
function promisifyCallback(globalObject, moduleName, funcName, funcToWrap) {
  const globalCallbackName = `${moduleName}_${funcName}Callback`;

  return new Promise((resolve, reject) => {
    /** @param {* | ModuleMethodError} arg */
    globalObject[globalCallbackName] = arg => {
      /** @type {keyof ModuleMethodError} */
      const errorKey = "isError";
      !!arg[errorKey] ? reject(arg) : resolve(arg);
    };

    funcToWrap();
  });
}

/**
 * Wrap an Android module.
 * @param {*} globalObject The global object - generally window.
 * @param {string} moduleName The name of the module that owns the method.
 * @param {*} module The Android module being wrapped.
 * @return {*} The wrapped module.
 */
export function wrapAndroidModule(globalObject, moduleName, module) {
  const wrappedModule = getModuleKeys(module)
    .filter(key => typeof module[key] === "function")
    .map(key => ({
      /** @param {*} args The method arguments */
      [key]: (...args) => {
        const funcToWrap = module[key].bind(module, ...args);
        return promisifyCallback(globalObject, moduleName, key, funcToWrap);
      }
    }))
    .reduce((acc, item) => ({ ...acc, ...item }), {});

  return {
    /**
     * @param {string} method The name of the method being invoked.
     * @param {ModuleMethodParameter[]} args The method arguments.
     */
    invoke: (method, ...args) =>
      wrappedModule[method](...args.map(({ paramValue }) => paramValue))
  };
}

/**
 * Wrap an iOS module.
 * @param {*} globalObject The global object - generally window.
 * @param {string} moduleName The name of the module that owns the method.
 * @param {*} module The iOS module being wrapped.
 * @return {*} The wrapped module.
 */
export function wrapIOSModule(globalObject, moduleName, module) {
  return {
    /**
     * @param {string} method The name of the method being invoked.
     * @param {ModuleMethodParameter[]} args The method arguments.
     */
    invoke: (method, ...args) => {
      const funcToWrap = module.postMessage.bind(module, {
        method,
        ...args
          .map(({ paramName, paramValue }) => ({ [paramName]: paramValue }))
          .reduce((acc, item) => ({ ...acc, ...item }), {})
      });

      return promisifyCallback(globalObject, moduleName, method, funcToWrap);
    }
  };
}

/**
 * Create a parameter object to work with both Android and iOS module wrappers.
 * @param {string} paramName The parameter name.
 * @param {*} paramValue The parameter value.
 * @return {ModuleMethodParameter} A Parameter object.
 */
export function createModuleMethodParameter(paramName, paramValue) {
  return { paramName, paramValue };
}

/**
 * Wrap the appropriate module based on whether or not it's Android/iOS.
 * @param {*} globalObject The global object - generally window.
 * @param {string} moduleName The name of the module being wrapped.
 */
export function wrapModule(globalObject, moduleName) {
  if (!!globalObject[moduleName]) {
    const androidModule = globalObject[moduleName];
    const wrappedModule = wrapAndroidModule(window, moduleName, androidModule);
    globalObject[moduleName] = wrappedModule;
  } else if (
    !!globalObject.webkit &&
    !!globalObject.webkit.messageHandlers &&
    !!globalObject.webkit.messageHandlers[moduleName]
  ) {
    const iOSModule = globalObject.webkit.messageHandlers[moduleName];
    const wrappedModule = wrapIOSModule(globalObject, moduleName, iOSModule);
    globalObject.webkit.messageHandlers[moduleName] = wrappedModule;
  }
}
