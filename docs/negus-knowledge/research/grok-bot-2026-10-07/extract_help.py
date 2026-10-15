"""Derive readable public help article text; retain raw HTML as evidence."""
from html.parser import HTMLParser
from pathlib import Path
class Extract(HTMLParser):
    def __init__(self):
        super().__init__(); self.skip=0; self.main=0; self.parts=[]
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style'): self.skip+=1
        if tag=='main': self.main+=1
        if tag in ('h1','h2','h3','p','li','tr','br'): self.parts.append('\n')
    def handle_endtag(self,tag):
        if tag in ('script','style'): self.skip=max(0,self.skip-1)
        if tag=='main': self.main=max(0,self.main-1)
    def handle_data(self,data):
        if not self.skip and self.main: self.parts.append(data)
for source in (Path(__file__).parent/'sources'/'official').glob('cursor-help-*.md'):
    parser=Extract(); parser.feed(source.read_text())
    body=''.join(parser.parts).split('Was this article helpful?',1)[0]
    source.with_suffix('.txt').write_text(body)
