// The number is put together in the browser so simple scraping bots can't read it from the page source.
(function () {
  var parts = ["427598", "887", "07"].reverse(), digits = parts[0] + parts[1] + parts[2].split("").reverse().join("");
  var a = document.createElement("a");
  a.href = "tel:+44" + digits.slice(1);
  a.textContent = digits.slice(0, 5) + " " + digits.slice(5);
  document.getElementById("phone").appendChild(a);
})();
