AFRAME.registerComponent('stats-param', {
  init: function () {
    if (AFRAME.utils.getUrlParameter('stats') === 'true') {
      setTimeout(() => {
        this.el.setAttribute('stats', '');
      }, 1000);
    }
  }
});
