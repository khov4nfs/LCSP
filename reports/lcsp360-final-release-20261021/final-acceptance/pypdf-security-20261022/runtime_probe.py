"""Offline inspection of the installed distribution, used inside both real images."""
import io,json,sys
from importlib.metadata import version,requires
from packaging.requirements import Requirement
from packaging.version import Version
from pypdf import PdfReader,PdfWriter
import pypdf
installed=version("pypdf")
requirement=next(Requirement(value) for value in requires("lcsp-agent-runtime") if Requirement(value).name.lower()=="pypdf")
assert Version("6.21.1")<=Version(installed)<Version("7")
assert not requirement.specifier.contains("6.20.1")
assert requirement.specifier.contains("6.21.1")
assert not requirement.specifier.contains("7.0.0")
assert requirement.specifier.contains(installed)
writer=PdfWriter();writer.add_blank_page(width=72,height=72)
stream=io.BytesIO();writer.write(stream);stream.seek(0)
assert len(PdfReader(stream).pages)==1
print(json.dumps({"python":sys.version.split()[0],"executable":sys.executable,"pypdfVersion":installed,"pypdfPath":pypdf.__file__,"installedAppRequires":str(requirement),"rejectsVulnerableVersion":True,"acceptsPatchedVersion":True,"rejectsNextMajor":True,"minimalPdfRoundTripPages":1,"network":"not used","providerCalls":0}))
