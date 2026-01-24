export class Router {
  constructor() {
    this.routes = new Map();
    this.listeners = [];
    this.currentPath = window.location.pathname;

    window.addEventListener('popstate', () => this.notifyListeners());
  }

  register(path, component) {
    this.routes.set(path, component);
  }

  navigate(path) {
    window.history.pushState(null, '', path);
    this.currentPath = path;
    this.notifyListeners();
  }

  getCurrentPath() {
    return this.currentPath;
  }

  getComponent() {
    return this.routes.get(this.currentPath) || this.routes.get('/');
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notifyListeners() {
    this.listeners.forEach(listener => listener());
  }
}

export const router = new Router();
