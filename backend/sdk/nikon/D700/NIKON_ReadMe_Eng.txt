Nikon Type0001 Module SDK Revision.19 summary


Usage
 Control the camera.


Supported camera
 D3(*1), D300(*2), D700(*3), D300S, D3S
 
   (*1) D3 camera has 4type, as follows. The 4type will be the same 
        specification,if there are no special explanations.
        If there is D3 description, that means all D3 camera.
        *D3  (Ver.1.0)
        *D3 FirmUp1 (Ver.1.1)
        *D3 FirmUp2 (Ver.2.0)
        *D3 FirmUp3 (Ver.2.02)
   (*2) D300 camera has 2type, as follows. The 2type will be the same
        specification, if there are no special explanations.
        If there is D300 description, that means all D300 camera.
        *D300  (Ver.1.0)
        *D300 FirmUp (Ver.1.1)
   (*3) D700 camera has 2type, as follows. The 2type will be the same
        specification, if there are no special explanations.
        If there is D700 description, that means all D700 camera.
        *D700  (Ver.1.0)
        *D700 FirmUp (Ver.1.02)


Environment of operation
 [Windows]
    Windows 10 64bit edition
    Windows 11 64bit edition
    * Please set Camera to PTP mode by SET UP menu (on camera body). If the 
      camera is set to Mass Storage, you can not control it by Windows.
    * You must install "microsoft visual c++ redistributable package for visual studio 2017"

 [Macintosh]
    macOS 12.5(Monterey)
    macOS 13(Ventura)
    macOS 14(Sonoma)
    * 64bit mode only (32bit mode is not supported)
    * Please set Camera to PTP mode by SET UP menu (on camera body). If the 
      camera is set to Mass Storage, you can not control it by Macintosh.


Contents
 [Windows]
    Documents
      MAID3(E).pdf : Basic interface specification
      MAID3Type0001(E).pdf : Extended interface specification used 
                                                              by Type0001 Module
      Usage of Type0001 Module(E).pdf : Notes for using Type0001 Module
      Type0001 Sample Guide(E).pdf : The usage of a sample program

    Binary Files
      Type0001.md3 : Type0001 Module for Win
      NkdPTP.dll : Driver for PTP mode used by Win
      dnssd.dll : Driver for PTP mode used by Win
      NkRoyalmile.dll : Driver for PTP mode used by Win

    Header Files
      Maid3.h : Basic header file of MAID interface
      Maid3d1.h : Extended header file for Type0001 Module
      NkTypes.h : Definitions of the types used in Maid3.h
      NkEndian.h : Definitions of the types used in this program
      Nkstdint.h : Definitions of the types used in this program

    Sample Program
      Type0001CtrlSample(Win) : Project for Microsoft Visual Studio 2017


 [Macintosh]
    Documents
      MAID3(E).pdf : Basic interface specification
      MAID3Type0001(E).pdf : Extended interface specification used by 
                                                                Type0001 Module
      Usage of Type0001 Module(E).pdf : Notes for using Type0001 Module
      Type0001 Sample Guide(E).pdf : The usage of a sample program
      [Mac OS] Notice about using Module SDK(E).txt : Notes for using SDK
                                                                on Mac OS

    Binary Files
        Type0001 Module.bundle : Type0001 Module for Mac
        libNkPTPDriver2.dylib : PTP driver for Mac
        Royalmile.framework : PTP driver for Mac

    Header Files
      Maid3.h : Basic header file of MAID interface
      Maid3d1.h : Extended header file for Type0001 Module
      NkTypes.h : Definitions of the types used in Maid3.h
      NkEndian.h : Definitions of the types used in this program
      Nkstdint.h : Definitions of the types used in this program

    Sample Program
      Type0001CtrlSample(Mac) : Sample program project for Xcode 13.2.1(BaseSDK : macOS)


Limitations
 This module cannot control two or more cameras.

Cautions
 When using the New SDK,  dnssd.dll and NkRoyalmile.dll are required.
 Please refer the following document and notice.
 - Type0001 Sample Guide(E).pdf
  "Files - Windows"
