import subprocess
import os
import http.client, urllib
import schedule
import time
import string
import random
from lxml import html
from dotenv import load_dotenv
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.firefox_profile import FirefoxProfile
from pathlib2 import Path

load_dotenv()
PUSHOVER_USER = os.getenv('PUSHOVER_USER')
PUSHOVER_TOKEN = os.getenv('PUSHOVER_TOKEN')
CRAWL_PERIOD_IN_MINUTES = os.getenv('CRAWL_PERIOD_IN_MINUTES', 15)
URL_TO_CRAWL = os.getenv('URL_TO_CRAWL')
XPATH = os.getenv('XPATH')

class bcolors:
    HEADER = '\033[95m'
    OKBLUE = '\033[94m'
    OKCYAN = '\033[96m'
    OKGREEN = '\033[92m'
    WARNING = '\033[93m'
    FAIL = '\033[91m'
    ENDC = '\033[0m'
    BOLD = '\033[1m'
    UNDERLINE = '\033[4m'


class CrawlResult:
    def __init__(self, value: str, page_title:str):
        self.value = value
        self.page_title = page_title


class Job:
    def __init__(self, url: str, xpath:str):
        self.url = url
        self.xpath = xpath
        self.previousValue=""

    def launch(self):
        self.notify(extract_value(
            crawl_url(self.url),
            self.xpath
        ))

    def notify(self, crawl_result:CrawlResult):
        if crawl_result is None:
            conn = http.client.HTTPSConnection("api.pushover.net:443")
            conn.request("POST", "/1/messages.json",
            urllib.parse.urlencode({
                "token": PUSHOVER_TOKEN,
                "user": PUSHOVER_USER,
                "message": f"Impossible de crawler {self.url} avec le selecteur {self.xpath}",
                "title": "Erreur"
            }), { "Content-type": "application/x-www-form-urlencoded" })
            conn.getresponse()
        else :
            print(crawl_result.__dict__)
            message= f"Nouvelle valeur : {crawl_result.value}\n{self.url}"
            title= crawl_result.page_title
            if self.previousValue is not crawl_result.value:
                self.previousValue=crawl_result.value
                conn = http.client.HTTPSConnection("api.pushover.net:443")
                conn.request("POST", "/1/messages.json",
                urllib.parse.urlencode({
                    "token": PUSHOVER_TOKEN,
                    "user": PUSHOVER_USER,
                    "message": message,
                    "title": f"Nouvelle valeur pour {title[:20]}..."
                }), { "Content-type": "application/x-www-form-urlencoded" })
                conn.getresponse()

def randomword(length):
   letters = string.ascii_lowercase
   return ''.join(random.choice(letters) for i in range(length))

def crawl_url(url: str) -> str:
    print(f"GET {url}")
    profile = FirefoxProfile()
    profile.set_preference("general.useragent.override", randomword(8))
    options=Options()
    options.profile=profile
    options.add_argument("--headless")
    driver = webdriver.Firefox(options=options)
    driver.get(url)
    html= driver.page_source
    driver.quit()
    return html


def extract_value(response_body:str, xpath:str) -> CrawlResult:
    tree = html.fromstring(response_body)
    value=tree.xpath(xpath)
    pageTitle=tree.xpath('//title/text()')
    if value and pageTitle:
        print_result(f"Extract value", True)
        return CrawlResult(
            value[0],
            pageTitle[0]
        )
    else:
        print_result(f"Extract value", False)
        return None

def print_result(message:str, ok:bool):
    if ok:
        print(f"{bcolors.OKGREEN}[OK]{bcolors.ENDC} {message}")
    else:
        print(f"{bcolors.FAIL}[KO]{bcolors.ENDC} {message}")


def test():
    Job(
        URL_TO_CRAWL,
        XPATH
    ).launch()


version = Path('version.txt').read_text()
print(f"Web Watcher v{version}")

schedule.every(int(CRAWL_PERIOD_IN_MINUTES)).minutes.do(test)

Job(
        URL_TO_CRAWL,
        XPATH
    ).launch()


while True:
    schedule.run_pending()
    time.sleep(1)