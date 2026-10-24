Nikon Type0022 Module SDK Revision.9 summary


Usage
 Control the camera.


Supported camera
 D850


Environment of operation
 [Windows]
    Windows 10 64bit edition
    Windows 11 64bit edition
    * You must install "microsoft visual c++ redistributable package for visual studio 2017"

 [Macintosh]
    macOS 12.5(Monterey)
    macOS 13(Ventura)
    macOS 14(Sonoma)
    * 64bit mode only (32bit mode is not supported)



Contents
 [Windows]
    Documents
      MAID3(E).pdf : Basic interface specification
      MAID3Type0022(E).pdf : Extended interface specification used 
                                                              by Type0022 Module
      Usage of Type0022 Module(E).pdf : Notes for using Type0022 Module
      Type0022 Sample Guide(E).pdf : The usage of a sample program

    Binary Files
      Type0022.md3 : Type0022 Module for Win
      NkdPTP.dll : Driver for PTP mode used by Win
      dnssd.dll : Driver for PTP mode used by Win
      NkRoyalmile.dll : Driver for PTP mode used by Win

    Header Files
      Maid3.h : Basic header file of MAID interface
      Maid3d1.h : Extended header file for Type0022 Module
      NkTypes.h : Definitions of the types used in this program
      NkEndian.h : Definitions of the types used in this program
      Nkstdint.h : Definitions of the types used in this program

    Sample Program
      Type0022CtrlSample(Win) : Project for Microsoft Visual Studio 2017

 [Macintosh]
    Documents
      MAID3(E).pdf : Basic interface specification
      MAID3Type0022(E).pdf : Extended interface specification used
                                                             by Type0022 Module
      Usage of Type0022 Module(E).pdf : Notes for using Type0022 Module
      Type0022 Sample Guide(E).pdf : The usage of a sample program
      [Mac OS] Notice about using Module SDK(E).txt : Notes for using SDK
                                                                on Mac OS

    Binary Files
      Type0022 Module.bundle : Type0022 Module for Mac
      libNkPTPDriver2.dylib : PTP driver for Mac 
      Royalmile.framework : PTP driver for Mac

    Header Files
      Maid3.h : Basic header file of MAID interface
      Maid3d1.h : Extended header file for Type0022 Module
      NkTypes.h : Definitions of the types used in this program
      NkEndian.h : Definitions of the types used in this program
      Nkstdint.h : Definitions of the types used in this program

    Sample Program
      Type0022CtrlSample(Mac) : Sample program project for Xcode 13.2.1(BaseSDK : macOS)


Limitations
 This module cannot control two or more cameras.

Cautions
 When using the New SDK,  dnssd.dll and NkRoyalmile.dll are required.
 Please refer the following document and notice.
 - Type0022 Sample Guide(E).pdf
  "Files - Windows"
